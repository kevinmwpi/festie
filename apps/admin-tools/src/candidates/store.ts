/**
 * Candidate bundles on disk (`seed-data/candidates/<slug>/`, see ./types.ts). Used by the CLI
 * (`candidate:*`) and by the local review tool (../review). Every function takes an optional `root`
 * (the `seed-data` directory) so tests can point it at a temp directory.
 *
 * Paths recorded in JSON (`GoldenFestival.seed_file`, `candidate.promoted.seed_file`, …) are relative
 * to the parent of the seed-data directory, i.e. the repo root: `seed-data/head-trip-2026.json`.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from '../env';
import { buildSeedFromCsv, CSV_FILES, CSV_SCHEMAS, type CsvFileName, type CsvInput } from '../festival/import-csv';
import type { FestivalSeed, SetRecord, ValidationIssue } from '../festival/types';
import { formatIssues, validateFestivalSeed } from '../festival/validate';
import { parseCsvRecords } from '../lib/csv';
import { festivalDayOf, parseOffsetTimestamp } from '../lib/time';
import { readRegistry, readRegistryOrEmpty, sha256Of, subjectKey, writeRegistry } from '../media/registry';
import type { MediaEntry, MediaRegistry, MediaReview } from '../media/types';
import {
  addSubjectsFromSeed,
  entryHasErrors,
  errorsOf,
  formatMediaIssues,
  MEDIA_FILE_PATTERN,
  validateRegistry,
  type SubjectMap,
} from '../media/validate';
import { assertSlug } from './slug';
import {
  CANDIDATE_SECTIONS,
  CANDIDATE_VERSION,
  type CandidateFile,
  type CandidateReview,
  type CandidateSection,
  type CandidateSource,
  type CandidateStatus,
  type Confidence,
  type EvalReport,
  type GoldenFestival,
  type GoldenIndex,
  type SectionDecision,
} from './types';

export interface CandidateSummary {
  slug: string;
  name: string;
  status: CandidateFile['status'];
  created_at: string;
  counts: { stages: number; artists: number; sets: number };
  media: { pending: number; approved: number; rejected: number };
  /** Validation problems of the CSVs as they are now. */
  errors: number;
  warnings: number;
}

export interface LoadedCandidate {
  dir: string;
  file: CandidateFile;
  csv: CsvInput;
  /** `buildSeedFromCsv` then `validateFestivalSeed`; `seed` is null when either fails. */
  seed: FestivalSeed | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  media: MediaRegistry | null;
  /** Contents of REVIEW.md when present. */
  reviewMarkdown: string | null;
}

export interface PromoteResult {
  slug: string;
  /** The festival's slug in the golden index (differs from `slug` for a change candidate). */
  goldenSlug: string;
  festivalId: string;
  seedFile: string;
  csvDir: string;
  /** Media entries merged into seed-data/media/registry.json (approved ones only). */
  mediaMerged: number;
  /** Everything that would be written; nothing is touched on a dry run. */
  actions: string[];
}

export const CANDIDATE_FILE = 'candidate.json';
export const REVIEW_FILE = 'REVIEW.md';
export const MEDIA_REGISTRY_FILE = 'media/registry.json';
export const GOLDEN_INDEX_FILE = 'golden/index.json';

const CANDIDATE_STATUSES: readonly CandidateStatus[] = ['needs_review', 'approved', 'rejected', 'promoted'];
const DECISIONS: readonly SectionDecision[] = ['pending', 'approved', 'rejected'];
const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];
const MEDIA_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** An approval must say who approved: media:validate rejects approved entries without `review.by`. */
function hasReviewerName(by: unknown): boolean {
  return typeof by === 'string' && by.trim() !== '';
}

// Paths -------------------------------------------------------------------------------------------

/** The `seed-data` directory (`root` when given). */
export function seedDataRoot(root?: string): string {
  return root ?? path.join(repoRoot(), 'seed-data');
}

export function candidatesRoot(root?: string): string {
  return path.join(seedDataRoot(root), 'candidates');
}

export function candidateDir(slug: string, root?: string): string {
  return path.join(candidatesRoot(root), assertSlug(slug));
}

export function goldenIndexPath(root?: string): string {
  return path.join(seedDataRoot(root), GOLDEN_INDEX_FILE);
}

/** `seed-data/<slug>.json` style path for JSON records and log lines. */
function repoRelative(filePath: string, root?: string): string {
  return path.relative(path.dirname(seedDataRoot(root)), filePath).split(path.sep).join('/');
}

// JSON files ---------------------------------------------------------------------------------------

function readJson(filePath: string): unknown {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`${filePath} not found`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${(error as Error).message}`);
  }
}

/** Same formatting as `festival:import-csv --out`: two-space indent and a trailing newline. */
function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function sectionRecord<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): Record<CandidateSection, T> {
  const source = isObject(raw) ? raw : {};
  const result = {} as Record<CandidateSection, T>;
  for (const section of CANDIDATE_SECTIONS) {
    result[section] = oneOf(source[section], allowed, fallback);
  }
  return result;
}

/**
 * Brings a parsed candidate.json into the `CandidateFile` shape: missing or malformed parts get their
 * defaults (so an agent's incomplete file is still reviewable), unknown keys are kept, and the
 * directory name wins over the `slug` field.
 */
export function normalizeCandidateFile(raw: unknown, slug: string): CandidateFile {
  if (!isObject(raw)) {
    throw new Error(`${slug}/${CANDIDATE_FILE} must be a JSON object`);
  }
  const review = isObject(raw.review) ? raw.review : {};
  const trigger = isObject(raw.trigger) ? raw.trigger : {};
  const agent = isObject(raw.agent) ? raw.agent : {};
  const promoted = isObject(raw.promoted) ? raw.promoted : null;
  const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : slug;
  return {
    ...raw,
    version: CANDIDATE_VERSION,
    slug,
    name,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    status: oneOf(raw.status, CANDIDATE_STATUSES, 'needs_review'),
    trigger: {
      kind: oneOf(trigger.kind, ['suggestion', 'scan', 'manual'] as const, 'manual'),
      suggestion_id: stringOrNull(trigger.suggestion_id),
      note: stringOrNull(trigger.note),
    },
    agent: {
      tool: typeof agent.tool === 'string' ? agent.tool : 'unknown',
      run_id: stringOrNull(agent.run_id),
      started_at: typeof agent.started_at === 'string' ? agent.started_at : '',
      finished_at: stringOrNull(agent.finished_at),
    },
    sources: Array.isArray(raw.sources) ? (raw.sources.filter(isObject) as unknown as CandidateSource[]) : [],
    confidence: sectionRecord(raw.confidence, CONFIDENCES, 'low'),
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    ...(isObject(raw.items) ? { items: raw.items as CandidateFile['items'] } : {}),
    review: {
      decisions: sectionRecord(review.decisions, DECISIONS, 'pending'),
      by: stringOrNull(review.by),
      at: stringOrNull(review.at),
      notes: stringOrNull(review.notes),
    },
    promoted:
      promoted && typeof promoted.at === 'string'
        ? {
            at: promoted.at,
            seed_file: typeof promoted.seed_file === 'string' ? promoted.seed_file : '',
            csv_dir: typeof promoted.csv_dir === 'string' ? promoted.csv_dir : '',
          }
        : null,
  } as CandidateFile;
}

function readCandidateFile(slug: string, root?: string): { dir: string; file: CandidateFile } {
  const dir = candidateDir(slug, root);
  const filePath = path.join(dir, CANDIDATE_FILE);
  if (!existsSync(filePath)) {
    throw new Error(`Candidate "${slug}" not found (no ${filePath})`);
  }
  return { dir, file: normalizeCandidateFile(readJson(filePath), slug) };
}

function writeCandidateFile(dir: string, file: CandidateFile): void {
  writeJson(path.join(dir, CANDIDATE_FILE), file);
}

// CSVs and the seed --------------------------------------------------------------------------------

interface BuiltSeed {
  seed: FestivalSeed | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Reads the four CSVs; a missing file is an error with path `<file>: missing` and an empty text. */
function readCsvInput(dir: string): { csv: CsvInput; errors: ValidationIssue[] } {
  const csv = {} as CsvInput;
  const errors: ValidationIssue[] = [];
  for (const file of CSV_FILES) {
    const filePath = path.join(dir, file);
    if (existsSync(filePath)) {
      csv[file] = readFileSync(filePath, 'utf8');
    } else {
      csv[file] = '';
      errors.push({ path: `${file}: missing`, message: `expected ${filePath}` });
    }
  }
  return { csv, errors };
}

/** `buildSeedFromCsv` then `validateFestivalSeed`; the result has either a seed or errors. */
export function buildCandidateSeed(csv: CsvInput): BuiltSeed {
  const built = buildSeedFromCsv(csv);
  if (!built.seed) {
    return { seed: null, errors: built.errors, warnings: [] };
  }
  const validated = validateFestivalSeed(built.seed);
  return { seed: validated.seed, errors: validated.errors, warnings: validated.warnings };
}

/** Data rows of one CSV, ignoring any problem in it (for counts while a bundle is still broken). */
function countRows(text: string, file: CsvFileName): number {
  try {
    return parseCsvRecords(text, file, CSV_SCHEMAS[file]).length;
  } catch {
    return 0;
  }
}

/** The candidate's own `media/registry.json`, or null when it has none. */
function readMediaRegistry(dir: string): MediaRegistry | null {
  const filePath = path.join(dir, MEDIA_REGISTRY_FILE);
  return existsSync(filePath) ? readRegistry(filePath) : null;
}

function mediaCounts(registry: MediaRegistry | null): CandidateSummary['media'] {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const entry of registry?.entries ?? []) {
    const status = entry.review?.status;
    if (status === 'approved' || status === 'rejected') {
      counts[status] += 1;
    } else {
      counts.pending += 1;
    }
  }
  return counts;
}

// Listing and loading ------------------------------------------------------------------------------

export async function listCandidates(root?: string): Promise<CandidateSummary[]> {
  const base = candidatesRoot(root);
  if (!existsSync(base)) {
    return [];
  }
  const summaries: CandidateSummary[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) {
      continue;
    }
    const dir = path.join(base, entry.name);
    const filePath = path.join(dir, CANDIDATE_FILE);
    if (!existsSync(filePath)) {
      continue;
    }
    summaries.push(summarizeCandidate(entry.name, dir, filePath));
  }
  return summaries.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.slug.localeCompare(b.slug));
}

function summarizeCandidate(slug: string, dir: string, filePath: string): CandidateSummary {
  let file: CandidateFile;
  try {
    file = normalizeCandidateFile(readJson(filePath), slug);
  } catch {
    // A broken candidate.json still shows up, so the reviewer sees that it needs fixing.
    return {
      slug,
      name: slug,
      status: 'needs_review',
      created_at: statSync(filePath).mtime.toISOString(),
      counts: { stages: 0, artists: 0, sets: 0 },
      media: { pending: 0, approved: 0, rejected: 0 },
      errors: 1,
      warnings: 0,
    };
  }
  const { csv, errors: missing } = readCsvInput(dir);
  const built = missing.length === 0 ? buildCandidateSeed(csv) : { seed: null, errors: missing, warnings: [] };
  let media: MediaRegistry | null = null;
  let mediaBroken = 0;
  try {
    media = readMediaRegistry(dir);
  } catch {
    mediaBroken = 1;
  }
  return {
    slug,
    name: file.name,
    status: file.status,
    created_at: file.created_at,
    counts: built.seed
      ? { stages: built.seed.stages.length, artists: built.seed.artists.length, sets: built.seed.sets.length }
      : {
          stages: countRows(csv['stages.csv'], 'stages.csv'),
          artists: countRows(csv['artists.csv'], 'artists.csv'),
          sets: countRows(csv['sets.csv'], 'sets.csv'),
        },
    media: mediaCounts(media),
    errors: built.errors.length + mediaBroken,
    warnings: built.warnings.length,
  };
}

export async function loadCandidate(slug: string, root?: string): Promise<LoadedCandidate> {
  const { dir, file } = readCandidateFile(slug, root);
  const { csv, errors: missing } = readCsvInput(dir);
  const built = missing.length === 0 ? buildCandidateSeed(csv) : { seed: null, errors: missing, warnings: [] };
  const reviewPath = path.join(dir, REVIEW_FILE);
  return {
    dir,
    file,
    csv,
    seed: built.seed,
    errors: built.errors,
    warnings: built.warnings,
    media: readMediaRegistry(dir),
    reviewMarkdown: existsSync(reviewPath) ? readFileSync(reviewPath, 'utf8') : null,
  };
}

/** Lines for `candidate:list`. */
export function formatCandidateTable(candidates: CandidateSummary[]): string {
  if (candidates.length === 0) {
    return 'No candidates.';
  }
  const rows = candidates.map((c) => [
    c.slug,
    c.status,
    `${c.counts.stages}/${c.counts.artists}/${c.counts.sets}`,
    `${c.media.pending}/${c.media.approved}/${c.media.rejected}`,
    c.errors > 0 || c.warnings > 0 ? `${c.errors} err ${c.warnings} warn` : 'ok',
    c.name,
  ]);
  const header = ['SLUG', 'STATUS', 'STG/ART/SETS', 'MEDIA p/a/r', 'ISSUES', 'NAME'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]))).join('  ');
  return [line(header), ...rows.map(line)].join('\n');
}

// Review -------------------------------------------------------------------------------------------

/** all approved → approved; any rejected → rejected; otherwise needs_review. */
export function deriveCandidateStatus(decisions: Record<CandidateSection, SectionDecision>): CandidateStatus {
  const values = CANDIDATE_SECTIONS.map((section) => decisions[section]);
  if (values.includes('rejected')) {
    return 'rejected';
  }
  return values.every((value) => value === 'approved') ? 'approved' : 'needs_review';
}

function checkDecisions(decisions: unknown): Record<CandidateSection, SectionDecision> {
  if (!isObject(decisions)) {
    throw new Error('review.decisions must be an object with festival, stages, artists and sets');
  }
  for (const key of Object.keys(decisions)) {
    if (!(CANDIDATE_SECTIONS as readonly string[]).includes(key)) {
      throw new Error(`review.decisions has an unknown section "${key}" (allowed: ${CANDIDATE_SECTIONS.join(', ')})`);
    }
  }
  const result = {} as Record<CandidateSection, SectionDecision>;
  for (const section of CANDIDATE_SECTIONS) {
    const value = decisions[section];
    if (!(DECISIONS as readonly unknown[]).includes(value)) {
      throw new Error(`review.decisions.${section} must be one of ${DECISIONS.join(', ')} (got ${JSON.stringify(value)})`);
    }
    result[section] = value as SectionDecision;
  }
  return result;
}

/** Writes the review block and derives `status` (all approved → approved, any rejected → rejected, else needs_review). */
export async function saveCandidateReview(slug: string, review: CandidateReview, root?: string): Promise<CandidateFile> {
  const { dir, file } = readCandidateFile(slug, root);
  if (file.status === 'promoted') {
    throw new Error(`Candidate "${slug}" was promoted on ${file.promoted?.at ?? 'an earlier run'}; its review is final`);
  }
  const decisions = checkDecisions(review.decisions);
  if (review.by !== null && typeof review.by !== 'string') {
    throw new Error('review.by must be a string or null');
  }
  if (CANDIDATE_SECTIONS.some((section) => decisions[section] === 'approved') && !hasReviewerName(review.by)) {
    throw new Error('Approving a section records who approved it; enter a reviewer name');
  }
  const updated: CandidateFile = {
    ...file,
    status: deriveCandidateStatus(decisions),
    review: {
      decisions,
      by: review.by,
      at: review.at ?? new Date().toISOString(),
      notes: review.notes ?? null,
    },
  };
  writeCandidateFile(dir, updated);
  return updated;
}

export async function saveCandidateMediaReview(slug: string, index: number, review: MediaReview, root?: string): Promise<MediaEntry> {
  const { dir } = readCandidateFile(slug, root);
  const registry = readMediaRegistry(dir);
  if (!registry) {
    throw new Error(`Candidate "${slug}" has no ${MEDIA_REGISTRY_FILE}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= registry.entries.length) {
    throw new Error(`Media entry ${index} does not exist (the registry has ${registry.entries.length} entries)`);
  }
  if (!(MEDIA_REVIEW_STATUSES as readonly string[]).includes(review.status)) {
    throw new Error(`Media review status must be one of ${MEDIA_REVIEW_STATUSES.join(', ')} (got ${JSON.stringify(review.status)})`);
  }
  if (review.status === 'approved' && !hasReviewerName(review.by)) {
    throw new Error('Approving an image records who approved it; enter a reviewer name');
  }
  const entry: MediaEntry = {
    ...registry.entries[index],
    review: { status: review.status, by: review.by, at: review.at ?? new Date().toISOString(), note: review.note ?? null },
  };
  registry.entries[index] = entry;
  writeRegistry(registry, path.join(dir, MEDIA_REGISTRY_FILE));
  return entry;
}

// Golden index -------------------------------------------------------------------------------------

export function readGoldenIndex(root?: string): GoldenIndex {
  const filePath = goldenIndexPath(root);
  if (!existsSync(filePath)) {
    return { version: 1, festivals: [] };
  }
  const raw = readJson(filePath);
  if (!isObject(raw) || !Array.isArray(raw.festivals)) {
    throw new Error(`${filePath} must be {"version": 1, "festivals": [...]}`);
  }
  return { version: 1, festivals: raw.festivals as GoldenFestival[] };
}

// Promotion ----------------------------------------------------------------------------------------

export async function promoteCandidate(slug: string, options: { dryRun: boolean; root?: string }): Promise<PromoteResult> {
  const { root, dryRun } = options;
  const loaded = await loadCandidate(slug, root);
  const { dir, file } = loaded;

  if (file.status === 'promoted') {
    throw new Error(`Candidate "${slug}" was already promoted on ${file.promoted?.at ?? 'an earlier run'} (${file.promoted?.seed_file ?? ''})`);
  }
  const pending = CANDIDATE_SECTIONS.filter((section) => file.review.decisions[section] !== 'approved');
  if (file.status !== 'approved' || pending.length > 0) {
    throw new Error(
      `Candidate "${slug}" is ${file.status}; every section must be approved before it is promoted` +
        (pending.length > 0 ? ` (not approved: ${pending.map((s) => `${s}=${file.review.decisions[s]}`).join(', ')})` : ''),
    );
  }
  if (!loaded.seed || loaded.errors.length > 0) {
    throw new Error(`Candidate "${slug}" does not build a valid festival:\n${formatIssues(loaded.errors)}`);
  }
  const seed = loaded.seed;

  const seedRoot = seedDataRoot(root);
  const actions: string[] = [];

  // A festival that is already golden keeps its slug and files: a change candidate (any slug, e.g.
  // `<slug>-changes-<date>`) for the same festival id replaces them instead of leaving a second seed
  // file for one festival behind. An entry under this slug for another festival id is a clash.
  const golden = readGoldenIndex(root);
  const previous =
    golden.festivals.find((f) => f.festival_id === seed.festival.id) ?? golden.festivals.find((f) => f.slug === slug);
  if (previous && previous.festival_id !== seed.festival.id) {
    throw new Error(
      `${repoRelative(goldenIndexPath(root), root)} lists ${previous.slug} with festival id ${previous.festival_id} but the candidate has ` +
        `${seed.festival.id}; pick another slug or put the existing id in festival.csv`,
    );
  }
  const goldenSlug = previous?.slug ?? slug;
  const seedFile = (previous && resolveGoldenPath(previous.seed_file, root)) ?? path.join(seedRoot, `${goldenSlug}.json`);
  const csvDir = (previous && resolveGoldenPath(previous.csv_dir, root)) ?? path.join(seedRoot, `${goldenSlug}-csv`);

  // Never replace another festival's file: the id is what users' groups and picks hang off.
  if (existsSync(seedFile)) {
    const existing = readJson(seedFile);
    const existingId = isObject(existing) && isObject(existing.festival) ? existing.festival.id : undefined;
    if (existingId !== seed.festival.id) {
      throw new Error(
        `${repoRelative(seedFile, root)} already exists with festival id ${String(existingId)} but the candidate has ` +
          `${seed.festival.id}; pick another slug or put the existing id in festival.csv`,
      );
    }
  }

  // 1. CSVs and the validated seed.
  const csvVerb = existsSync(csvDir) ? 'replace' : 'write';
  for (const name of CSV_FILES) {
    actions.push(`${csvVerb} ${repoRelative(path.join(csvDir, name), root)}`);
  }
  actions.push(
    `${existsSync(seedFile) ? 'replace' : 'write'} ${repoRelative(seedFile, root)} ` +
      `(${seed.festival.name}, ${seed.festival.status}: ${seed.stages.length} stages, ${seed.artists.length} artists, ${seed.sets.length} sets)`,
  );

  // 2. Approved media. Approved entries must pass the media:validate rules against this candidate's
  //    festival and artists (so the shared registry stays valid for media:upload), and the copy's source
  //    and destination are derived from the checked `<folder>/<uuid>.<ext>` path, never from the raw
  //    `file` string: a candidate must not write anywhere but seed-data/media/<folder>/.
  const mediaRoot = path.join(seedRoot, 'media');
  const registryPath = path.join(mediaRoot, 'registry.json');
  const approvedMedia = (loaded.media?.entries ?? [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.review?.status === 'approved');
  const mediaCopies: Array<{ from: string; to: string }> = [];
  let registry: MediaRegistry | null = null;
  if (approvedMedia.length > 0) {
    const candidateMediaDir = path.join(dir, 'media');
    const subjects: SubjectMap = new Map();
    addSubjectsFromSeed(subjects, seed);
    const issues = errorsOf(validateRegistry(loaded.media, { dir: candidateMediaDir, subjects }));
    const blocked = approvedMedia.filter(({ index }) => entryHasErrors(issues, index)).map(({ index }) => `entries[${index}]`);
    if (blocked.length > 0) {
      const relevant = issues.filter((issue) => blocked.some((prefix) => issue.path === prefix || issue.path.startsWith(`${prefix}.`)));
      throw new Error(
        `Candidate "${slug}" has approved media that media:validate rejects; fix or reject ${blocked.length === 1 ? 'the entry' : 'these entries'} first:\n` +
          formatMediaIssues(relevant),
      );
    }
    const mediaReal = realpathSync(candidateMediaDir);
    const shared = readRegistryOrEmpty(registryPath);
    registry = shared;
    for (const { entry } of approvedMedia) {
      const match = MEDIA_FILE_PATTERN.exec(entry.file);
      if (!match) {
        throw new Error(`Approved media entry ${entry.file} must match <artists|festivals>/<uuid>.<jpg|png|webp>`);
      }
      const [, folder, fileId, extension] = match;
      const fileName = `${fileId}.${extension}`;
      const from = checkedMediaSource(path.join(candidateMediaDir, folder, fileName), mediaReal, entry.file);
      if (!SHA256_PATTERN.test(entry.sha256)) {
        throw new Error(`Approved media entry ${entry.file} needs a sha256 (64 lowercase hex characters) so the copy can be checked`);
      }
      const actual = sha256Of(readFileSync(from));
      if (actual !== entry.sha256) {
        throw new Error(`Media file ${entry.file} changed since it was recorded (sha256 ${actual}, registry says ${entry.sha256})`);
      }
      const to = path.join(mediaRoot, folder, fileName);
      mediaCopies.push({ from, to });
      const subject = subjectKey(entry.subject_type, entry.subject_id);
      const replaced = shared.entries.filter((e) => subjectKey(e.subject_type, e.subject_id) === subject);
      shared.entries = shared.entries.filter((e) => subjectKey(e.subject_type, e.subject_id) !== subject);
      shared.entries.push(entry);
      actions.push(
        `copy media/${folder}/${fileName} to ${repoRelative(to, root)}` +
          (replaced.length > 0 ? ` (replaces ${replaced.map((e) => e.file).join(', ')} for ${entry.subject_name})` : ''),
      );
    }
    actions.push(`${existsSync(registryPath) ? 'update' : 'write'} ${repoRelative(registryPath, root)} (+${approvedMedia.length} approved entries)`);
  }

  // 3. Golden index: the festival keeps its slug; `candidate` records which bundle the files came from.
  const promotedAt = new Date().toISOString();
  const seedFileRel = repoRelative(seedFile, root);
  const csvDirRel = repoRelative(csvDir, root);
  const goldenEntry: GoldenFestival = {
    slug: goldenSlug,
    festival_id: seed.festival.id,
    name: seed.festival.name,
    seed_file: seedFileRel,
    csv_dir: csvDirRel,
    candidate: slug,
    promoted_at: promotedAt,
    verified: null,
    notes: previous?.notes ?? null,
  };
  golden.festivals = [...golden.festivals.filter((f) => f !== previous), goldenEntry];
  actions.push(
    previous
      ? `replace ${previous.slug} (festival ${seed.festival.id}) in ${repoRelative(goldenIndexPath(root), root)}`
      : `add ${slug} in ${repoRelative(goldenIndexPath(root), root)}`,
  );

  // 4. The candidate itself.
  actions.push(`mark candidates/${slug}/${CANDIDATE_FILE} promoted`);

  const result: PromoteResult = { slug, goldenSlug, festivalId: seed.festival.id, seedFile, csvDir, mediaMerged: approvedMedia.length, actions };
  if (dryRun) {
    return result;
  }

  mkdirSync(csvDir, { recursive: true });
  for (const name of CSV_FILES) {
    writeFileSync(path.join(csvDir, name), loaded.csv[name], 'utf8');
  }
  writeJson(seedFile, seed);
  for (const copy of mediaCopies) {
    mkdirSync(path.dirname(copy.to), { recursive: true });
    copyFileSync(copy.from, copy.to);
  }
  if (registry) {
    writeRegistry(registry, registryPath);
  }
  writeJson(goldenIndexPath(root), golden);
  writeCandidateFile(dir, {
    ...file,
    status: 'promoted',
    promoted: { at: promotedAt, seed_file: seedFileRel, csv_dir: csvDirRel },
  });
  return result;
}

/** A `seed_file` / `csv_dir` recorded in the golden index (relative to the repo root); null when blank. */
function resolveGoldenPath(recorded: string | null | undefined, root?: string): string | null {
  return typeof recorded === 'string' && recorded.trim() !== '' ? path.resolve(path.dirname(seedDataRoot(root)), recorded) : null;
}

/**
 * The real file behind a candidate's media path. Refuses symbolic links and anything whose real path is
 * outside the candidate's media directory (`mediaReal`, its realpath), so a crafted bundle cannot make
 * the copy read from elsewhere in the repository.
 */
function checkedMediaSource(filePath: string, mediaReal: string, label: string): string {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(filePath);
  } catch {
    throw new Error(`Approved media entry ${label} has no file at ${filePath}`);
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Approved media entry ${label} is a symbolic link; copy the image itself into the candidate's media directory`);
  }
  if (!stat.isFile()) {
    throw new Error(`Approved media entry ${label} is not a regular file (${filePath})`);
  }
  const real = realpathSync(filePath);
  if (!real.startsWith(mediaReal + path.sep)) {
    throw new Error(`Approved media entry ${label} resolves to ${real}, outside the candidate's media directory`);
  }
  return real;
}

// Evaluation ---------------------------------------------------------------------------------------

/** trim, collapse spaces, lower-case, strip diacritics: `Rüfüs  Du Sol` → `rufus du sol`. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function ratio(matched: number, total: number): number {
  return total === 0 ? (matched === 0 ? 1 : 0) : matched / total;
}

function compareNames(candidate: string[], golden: string[]): EvalReport['stages'] {
  const candidateByKey = new Map(candidate.map((name) => [normalizeName(name), name]));
  const goldenByKey = new Map(golden.map((name) => [normalizeName(name), name]));
  let matched = 0;
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [key, name] of goldenByKey) {
    if (candidateByKey.has(key)) {
      matched += 1;
    } else {
      missing.push(name);
    }
  }
  for (const [key, name] of candidateByKey) {
    if (!goldenByKey.has(key)) {
      extra.push(name);
    }
  }
  return { precision: ratio(matched, candidateByKey.size), recall: ratio(matched, goldenByKey.size), missing, extra };
}

interface SetView {
  artist: string;
  stage: string;
  start: Date;
  end: Date;
  record: SetRecord;
}

function setViews(seed: FestivalSeed): SetView[] {
  const artists = new Map(seed.artists.map((artist) => [artist.id, artist.name]));
  const stages = new Map(seed.stages.map((stage) => [stage.id, stage.name]));
  return seed.sets.map((record) => ({
    artist: artists.get(record.artist_id) ?? record.artist_id,
    stage: stages.get(record.stage_id) ?? record.stage_id,
    start: parseOffsetTimestamp(record.start_time) ?? new Date(NaN),
    end: parseOffsetTimestamp(record.end_time) ?? new Date(NaN),
    record,
  }));
}

/** Sets keyed by normalized artist + festival day (in the golden zone), each list in start order. */
function groupSets(views: SetView[], timeZone: string): Map<string, SetView[]> {
  const groups = new Map<string, SetView[]>();
  for (const view of views) {
    const key = `${normalizeName(view.artist)}|${festivalDayOf(view.start, timeZone)}`;
    const list = groups.get(key) ?? [];
    list.push(view);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  return groups;
}

function describeSet(view: SetView): string {
  return `${view.artist} @ ${view.record.start_time} on ${view.stage}${view.record.status !== 'scheduled' ? ` [${view.record.status}]` : ''}`;
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

export function compareSeeds(
  candidateSeed: FestivalSeed,
  goldenSeed: FestivalSeed,
  toleranceMinutes: number,
): Omit<EvalReport, 'candidate' | 'golden'> {
  const fields: Array<{ field: keyof FestivalSeed['festival']; fuzzy: boolean }> = [
    { field: 'name', fuzzy: true },
    { field: 'start_date', fuzzy: false },
    { field: 'end_date', fuzzy: false },
    { field: 'timezone', fuzzy: false },
    { field: 'venue_name', fuzzy: true },
  ];
  const festival_fields = fields.map(({ field, fuzzy }) => {
    const candidate = candidateSeed.festival[field] ?? null;
    const golden = goldenSeed.festival[field] ?? null;
    const match = fuzzy
      ? normalizeName(candidate as string | null) === normalizeName(golden as string | null)
      : candidate === golden;
    return { field, candidate, golden, match };
  });

  const stages = compareNames(candidateSeed.stages.map((s) => s.name), goldenSeed.stages.map((s) => s.name));
  const artists = compareNames(candidateSeed.artists.map((a) => a.name), goldenSeed.artists.map((a) => a.name));

  const timeZone = goldenSeed.festival.timezone;
  const candidateGroups = groupSets(setViews(candidateSeed), timeZone);
  const goldenGroups = groupSets(setViews(goldenSeed), timeZone);
  let matched = 0;
  let exact = 0;
  const time_errors: EvalReport['sets']['time_errors'] = [];
  const stage_mismatches: EvalReport['sets']['stage_mismatches'] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [key, goldenList] of goldenGroups) {
    const candidateList = candidateGroups.get(key) ?? [];
    goldenList.forEach((g, index) => {
      const c = candidateList[index];
      if (!c) {
        missing.push(describeSet(g));
        return;
      }
      matched += 1;
      const startOff = minutesBetween(g.start, c.start);
      const endOff = minutesBetween(g.end, c.end);
      if (Math.abs(startOff) <= toleranceMinutes && Math.abs(endOff) <= toleranceMinutes) {
        exact += 1;
      }
      if (Math.abs(startOff) > toleranceMinutes) {
        time_errors.push({
          artist: g.artist,
          golden_start: g.record.start_time,
          candidate_start: c.record.start_time,
          minutes_off: startOff,
        });
      }
      if (normalizeName(g.stage) !== normalizeName(c.stage)) {
        stage_mismatches.push({ artist: g.artist, golden_stage: g.stage, candidate_stage: c.stage });
      }
    });
    candidateList.slice(goldenList.length).forEach((c) => extra.push(describeSet(c)));
  }
  for (const [key, candidateList] of candidateGroups) {
    if (!goldenGroups.has(key)) {
      candidateList.forEach((c) => extra.push(describeSet(c)));
    }
  }

  return {
    festival_fields,
    stages,
    artists,
    sets: {
      lineup_only: candidateSeed.sets.length === 0,
      precision: ratio(matched, candidateSeed.sets.length),
      recall: ratio(matched, goldenSeed.sets.length),
      exact,
      time_errors,
      stage_mismatches,
      missing,
      extra,
    },
    tolerance_minutes: toleranceMinutes,
  };
}

export async function evaluateCandidate(
  slug: string,
  goldenSeedFile: string,
  options?: { toleranceMinutes?: number; root?: string },
): Promise<EvalReport> {
  const toleranceMinutes = options?.toleranceMinutes ?? 10;
  if (!Number.isFinite(toleranceMinutes) || toleranceMinutes < 0) {
    throw new Error(`tolerance must be a number of minutes ≥ 0 (got ${String(options?.toleranceMinutes)})`);
  }
  const loaded = await loadCandidate(slug, options?.root);
  if (!loaded.seed) {
    throw new Error(`Candidate "${slug}" does not build a valid festival:\n${formatIssues(loaded.errors)}`);
  }
  const goldenPath = path.resolve(goldenSeedFile);
  const golden = validateFestivalSeed(readJson(goldenPath));
  if (!golden.seed) {
    throw new Error(`${goldenPath} is not a valid festival file:\n${formatIssues(golden.errors)}`);
  }
  return { candidate: slug, golden: goldenPath, ...compareSeeds(loaded.seed, golden.seed, toleranceMinutes) };
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function list(label: string, items: string[]): string[] {
  if (items.length === 0) {
    return [];
  }
  return [`  ${label} (${items.length}):`, ...items.map((item) => `    - ${item}`)];
}

/** Readable summary for `scout:eval`. */
export function formatEvalReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Candidate ${report.candidate} vs golden ${report.golden} (tolerance ${report.tolerance_minutes} min)`);
  lines.push('');
  lines.push('Festival');
  const width = Math.max(...report.festival_fields.map((f) => f.field.length));
  for (const field of report.festival_fields) {
    const status = field.match ? 'ok  ' : 'DIFF';
    const value = field.match
      ? JSON.stringify(field.golden)
      : `candidate ${JSON.stringify(field.candidate)}, golden ${JSON.stringify(field.golden)}`;
    lines.push(`  ${status} ${field.field.padEnd(width)}  ${value}`);
  }
  for (const [label, section] of [['Stages', report.stages], ['Artists', report.artists]] as const) {
    lines.push('');
    lines.push(`${label}: precision ${percent(section.precision)}, recall ${percent(section.recall)}`);
    lines.push(...list('missing', section.missing), ...list('extra', section.extra));
  }
  const sets = report.sets;
  lines.push('');
  if (sets.lineup_only) {
    lines.push(`Sets: none in the candidate (set times to be announced); golden has ${sets.missing.length}`);
    return lines.join('\n');
  }
  lines.push(`Sets: precision ${percent(sets.precision)}, recall ${percent(sets.recall)}, exact ${sets.exact} (matched by artist + day; start and end within tolerance)`);
  lines.push(
    ...list(
      'time errors',
      sets.time_errors.map((e) => `${e.artist}: golden ${e.golden_start}, candidate ${e.candidate_start} (${e.minutes_off > 0 ? '+' : ''}${e.minutes_off} min)`),
    ),
    ...list('stage mismatches', sets.stage_mismatches.map((m) => `${m.artist}: golden ${m.golden_stage}, candidate ${m.candidate_stage}`)),
    ...list('missing', sets.missing),
    ...list('extra', sets.extra),
  );
  return lines.join('\n');
}
