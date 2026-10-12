/**
 * `media:*` commands. The option-object functions (`mediaValidate`, `mediaUpload`, `mediaFetchCommons`,
 * `mediaFetchCommonsForSeed`) are the API; `MEDIA_COMMANDS` wraps them for the CLI's argv dispatch and
 * `MEDIA_HELP` is the block for its help text.
 */
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createAdminClient,
  readJsonFile,
  readSupabaseConfig,
  repoRoot,
  requireSupabaseConfig,
  resolveInputPath,
  UsageError,
} from '../env';
import { buildSeedFromCsv, CSV_FILES, type CsvInput } from '../festival/import-csv';
import { formatIssues } from '../festival/validate';
import { isUuid } from '../lib/uuid';
import { CommonsClient, fetchCommonsCandidate, type CommonsFetchResult, type FetchLike } from './commons';
import { defaultRegistryFile, entriesFor, readRegistry, readRegistryOrEmpty, registryDir, upsertEntry, writeRegistry } from './registry';
import type { MediaRegistry } from './types';
import {
  applyMediaUpload,
  describeMediaPlan,
  planIsEmpty,
  planMediaUpload,
  type MediaApplyResult,
  type MediaUploadPlan,
} from './upload';
import {
  defaultSeedDataDir,
  errorsOf,
  formatMediaIssues,
  listSubjectFiles,
  loadSubjects,
  validateRegistry,
  warningsOf,
  type MediaValidationIssue,
} from './validate';

export type Log = (line: string) => void;
const quiet: Log = () => {};

export const MEDIA_VALIDATE_USAGE = 'media:validate [--file <registry>]';
export const MEDIA_UPLOAD_USAGE = 'media:upload [--dry-run] [--file <registry>]';
export const MEDIA_FETCH_COMMONS_USAGE =
  'media:fetch-commons --artist <name> --artist-id <uuid> [--wikidata <Q..>] [--into <dir>]\n' +
  '       media:fetch-commons --seed <file> [--into <dir>]';

export const MEDIA_HELP = `Media (licensed images, seed-data/media/README.md)
  media:validate [--file <registry>]               Check seed-data/media/registry.json and its files (offline)
  media:upload [--dry-run] [--file <registry>]     Upload approved images to the artwork bucket, write image columns, bump versions
  media:fetch-commons --artist <name> --artist-id <uuid> [--wikidata <Q..>] [--into <dir>]
                                                   Fetch a CC-licensed artist photo from Wikimedia Commons as a pending entry
  media:fetch-commons --seed <file> [--into <dir>] Same for every artist of a festival file (or candidate CSV dir) without an entry`;

// media:validate -----------------------------------------------------------------------------------

export interface MediaValidateOptions {
  /** Registry file; defaults to seed-data/media/registry.json. */
  file?: string;
  /** The seed-data directory the subjects come from. */
  seedDataDir?: string;
  log?: Log;
}

export interface MediaValidateResult {
  file: string;
  registry: MediaRegistry;
  issues: MediaValidationIssue[];
  /** No blocking issue (warnings allowed). */
  ok: boolean;
  /** The lines `media:validate` prints. */
  text: string;
}

export async function mediaValidate(options: MediaValidateOptions = {}): Promise<MediaValidateResult> {
  const log = options.log ?? quiet;
  const file = options.file ? resolveInputPath(options.file) : defaultRegistryFile();
  const seedDataDir = options.seedDataDir ?? defaultSeedDataDir();
  const registry = readRegistry(file);
  const source = listSubjectFiles(seedDataDir);
  const subjects = loadSubjects(seedDataDir);
  const issues = validateRegistry(registry, { dir: registryDir(file), subjects });
  const errors = errorsOf(issues);
  const warnings = warningsOf(issues);
  const counts = { approved: 0, pending: 0, rejected: 0 };
  for (const entry of registry.entries) {
    const status = entry?.review?.status;
    if (status === 'approved' || status === 'pending' || status === 'rejected') {
      counts[status] += 1;
    }
  }
  const lines = [
    `${errors.length === 0 ? 'OK' : 'INVALID'} ${file}`,
    `${registry.entries.length} entr${registry.entries.length === 1 ? 'y' : 'ies'}: ${counts.approved} approved, ${counts.pending} pending, ${counts.rejected} rejected; ` +
      `${subjects.size} subject(s) from ${source.files.length} seed file(s) (${source.from === 'golden-index' ? 'golden/index.json' : 'seed-data/*.json'})`,
  ];
  if (warnings.length > 0) {
    lines.push(`Warnings:\n${formatMediaIssues(warnings)}`);
  }
  if (errors.length > 0) {
    lines.push(`Errors:\n${formatMediaIssues(errors)}`);
  }
  const text = lines.join('\n');
  log(text);
  return { file, registry, issues, ok: errors.length === 0, text };
}

// media:upload -------------------------------------------------------------------------------------

export interface MediaUploadOptions {
  dryRun: boolean;
  file?: string;
  seedDataDir?: string;
  /** Injected in tests; otherwise built from SUPABASE_URL + service-role key. */
  client?: SupabaseClient;
  supabaseUrl?: string;
  log?: Log;
}

export interface MediaUploadResult {
  validation: MediaValidateResult;
  /** Null when there were no credentials for a dry run (validation only). */
  plan: MediaUploadPlan | null;
  applied: MediaApplyResult | null;
}

export async function mediaUpload(options: MediaUploadOptions): Promise<MediaUploadResult> {
  const log = options.log ?? quiet;
  const validation = await mediaValidate({ file: options.file, seedDataDir: options.seedDataDir, log });
  if (!validation.ok) {
    throw new UsageError('Fix the registry before uploading (media:validate).');
  }

  let client = options.client;
  let supabaseUrl = options.supabaseUrl;
  if (!client) {
    const config = options.dryRun ? readSupabaseConfig() : requireSupabaseConfig();
    if (!config) {
      log('Dry run: registry is valid. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to also diff against the database.');
      return { validation, plan: null, applied: null };
    }
    client = createAdminClient(config);
    supabaseUrl = supabaseUrl ?? config.url;
  }
  if (!supabaseUrl) {
    throw new UsageError('mediaUpload needs supabaseUrl when a client is injected');
  }

  const subjects = loadSubjects(options.seedDataDir ?? defaultSeedDataDir());
  const plan = await planMediaUpload(client, validation.registry, { dir: registryDir(validation.file), supabaseUrl, subjects });
  log(describeMediaPlan(plan));
  if (options.dryRun) {
    log('Dry run: nothing written.');
    return { validation, plan, applied: null };
  }
  if (planIsEmpty(plan)) {
    return { validation, plan, applied: { uploaded: 0, updated: 0, cleared: 0, removed: 0, bumped: [] } };
  }
  const applied = await applyMediaUpload(client, plan, log);
  log(
    `Done: ${applied.uploaded} uploaded, ${applied.updated} row(s) updated, ${applied.cleared} cleared, ` +
      `${applied.removed} object(s) removed, ${applied.bumped.length} festival version(s) bumped.`,
  );
  return { validation, plan, applied };
}

// media:fetch-commons ------------------------------------------------------------------------------

export function defaultMediaDir(): string {
  return path.join(repoRoot(), 'seed-data', 'media');
}

export interface MediaFetchCommonsOptions {
  artist: string;
  artistId: string;
  wikidataId?: string | null;
  /** Media directory to write into (default seed-data/media); the registry is `<into>/registry.json`. */
  into?: string;
  registryFile?: string;
  fetch?: FetchLike;
  userAgent?: string;
  client?: CommonsClient;
  log?: Log;
}

export interface MediaFetchCommonsResult {
  result: CommonsFetchResult;
  registryFile: string;
  /** Files of replaced entries that were deleted because the new entry uses a different file. */
  removedFiles: string[];
}

function resolveMediaDir(into: string | undefined): string {
  return into ? path.resolve(process.env.INIT_CWD ?? process.cwd(), into) : defaultMediaDir();
}

/** Fetches one artist's photo and writes the pending entry into the registry (replacing the subject's entries). */
export async function mediaFetchCommons(options: MediaFetchCommonsOptions): Promise<MediaFetchCommonsResult> {
  const log = options.log ?? quiet;
  if (!options.artist || options.artist.trim() === '') {
    throw new UsageError('--artist must be the artist name');
  }
  if (!isUuid(options.artistId)) {
    throw new UsageError(`--artist-id must be the artist's UUID (artists.id), got "${options.artistId}"`);
  }
  if (options.wikidataId && !/^Q\d+$/.test(options.wikidataId.trim())) {
    throw new UsageError(`--wikidata must be a Wikidata item id like Q42, got "${options.wikidataId}"`);
  }
  const into = resolveMediaDir(options.into);
  const registryFile = options.registryFile ? path.resolve(options.registryFile) : path.join(into, 'registry.json');
  const client = options.client ?? new CommonsClient({ fetch: options.fetch, userAgent: options.userAgent });

  const result = await fetchCommonsCandidate({
    artistName: options.artist.trim(),
    artistId: options.artistId,
    wikidataId: options.wikidataId ?? null,
    into: registryDir(registryFile),
    client,
  });
  if (!result.ok) {
    log(`MISS ${options.artist}: ${result.reason}${result.fileName ? ` (File:${result.fileName})` : ''}`);
    return { result, registryFile, removedFiles: [] };
  }

  const registry = readRegistryOrEmpty(registryFile);
  const { replaced } = upsertEntry(registry, result.entry);
  writeRegistry(registry, registryFile);
  const removedFiles: string[] = [];
  for (const old of replaced) {
    if (old.file !== result.entry.file && entriesFor(registry, old.subject_type, old.subject_id).every((entry) => entry.file !== old.file)) {
      const oldPath = path.join(registryDir(registryFile), old.file);
      if (existsSync(oldPath) && statSync(oldPath).isFile()) {
        unlinkSync(oldPath);
        removedFiles.push(old.file);
      }
    }
    if (old.review.status === 'approved') {
      log(`WARNING replaced an APPROVED entry for ${old.subject_name}; the new one is pending (media:upload would clear the image).`);
    }
  }
  log(
    `HIT  ${options.artist}: ${result.entry.file} ${result.entry.license.id} (${result.entry.width ?? '?'}x${result.entry.height ?? '?'}) ` +
      `from ${result.entry.source.url} — pending review in ${registryFile}`,
  );
  return { result, registryFile, removedFiles };
}

export interface MediaFetchCommonsForSeedOptions {
  /** A festival JSON file or a candidate CSV directory (festival.csv, stages.csv, artists.csv, sets.csv). */
  seedFile: string;
  into?: string;
  registryFile?: string;
  fetch?: FetchLike;
  userAgent?: string;
  client?: CommonsClient;
  log?: Log;
  /** Stop after this many fetched artists (hits or misses); the rest stay without an entry. */
  limit?: number;
}

export interface SeedFetchSummary {
  seedFile: string;
  registryFile: string;
  hits: Array<{ artist: string; artistId: string; file: string; license: string }>;
  misses: Array<{ artist: string; artistId: string; stage: string; reason: string }>;
  /** Found on Commons but under a licence the app may not use. */
  rejected: Array<{ artist: string; artistId: string; license: string | null; fileName: string | null; reason: string }>;
  /** Artists that already had an entry (any status). */
  skipped: Array<{ artist: string; artistId: string; status: string }>;
  text: string;
}

function readSeedArtists(seedFile: string): Array<{ id: string; name: string }> {
  let raw: unknown;
  if (statSync(seedFile).isDirectory()) {
    const input = {} as CsvInput;
    for (const file of CSV_FILES) {
      const filePath = path.join(seedFile, file);
      if (!existsSync(filePath)) {
        throw new UsageError(`Missing ${filePath} (expected ${CSV_FILES.join(', ')})`);
      }
      input[file] = readFileSync(filePath, 'utf8');
    }
    const built = buildSeedFromCsv(input);
    if (!built.seed) {
      throw new UsageError(`${seedFile} is not a valid candidate:\n${formatIssues(built.errors)}`);
    }
    raw = built.seed.artists;
  } else {
    raw = (readJsonFile(seedFile) as { artists?: unknown }).artists;
  }
  if (!Array.isArray(raw)) {
    throw new UsageError(`${seedFile} has no "artists" array`);
  }
  const artists: Array<{ id: string; name: string }> = [];
  for (const artist of raw as Array<{ id?: unknown; name?: unknown }>) {
    if (!isUuid(artist?.id) || typeof artist?.name !== 'string' || artist.name.trim() === '') {
      throw new UsageError(`${seedFile}: every artist needs an id (UUID) and a name`);
    }
    artists.push({ id: artist.id, name: artist.name.trim() });
  }
  return artists;
}

/** Fetches a Commons photo for every artist of a seed without a registry entry; one shared rate limit. */
export async function mediaFetchCommonsForSeed(options: MediaFetchCommonsForSeedOptions): Promise<SeedFetchSummary> {
  const log = options.log ?? quiet;
  const seedFile = resolveInputPath(options.seedFile);
  if (!existsSync(seedFile)) {
    throw new UsageError(`File not found: ${seedFile}`);
  }
  const artists = readSeedArtists(seedFile);
  const into = resolveMediaDir(options.into);
  const registryFile = options.registryFile ? path.resolve(options.registryFile) : path.join(into, 'registry.json');
  const client = options.client ?? new CommonsClient({ fetch: options.fetch, userAgent: options.userAgent });
  const summary: SeedFetchSummary = { seedFile, registryFile, hits: [], misses: [], rejected: [], skipped: [], text: '' };

  let fetched = 0;
  for (const artist of artists) {
    const existing = entriesFor(readRegistryOrEmpty(registryFile), 'artist', artist.id);
    if (existing.length > 0) {
      const status = existing.find((entry) => entry.review.status === 'approved')?.review.status ?? existing[0].review.status;
      summary.skipped.push({ artist: artist.name, artistId: artist.id, status });
      continue;
    }
    if (options.limit !== undefined && fetched >= options.limit) {
      break;
    }
    fetched += 1;
    let outcome: CommonsFetchResult;
    try {
      ({ result: outcome } = await mediaFetchCommons({
        artist: artist.name,
        artistId: artist.id,
        into,
        registryFile,
        client,
        log,
      }));
    } catch (error) {
      if (error instanceof UsageError) {
        throw error;
      }
      // Network or API failure for one artist: record it and carry on with the next.
      outcome = { ok: false, stage: 'search', reason: (error as Error).message, wikidataId: null, fileName: null, license: null };
      log(`MISS ${artist.name}: ${outcome.reason}`);
    }
    if (outcome.ok) {
      summary.hits.push({ artist: artist.name, artistId: artist.id, file: outcome.entry.file, license: outcome.entry.license.id });
    } else if (outcome.stage === 'license') {
      summary.rejected.push({ artist: artist.name, artistId: artist.id, license: outcome.license, fileName: outcome.fileName, reason: outcome.reason });
    } else {
      summary.misses.push({ artist: artist.name, artistId: artist.id, stage: outcome.stage, reason: outcome.reason });
    }
  }

  const lines = [
    `Commons fetch for ${seedFile}: ${artists.length} artist(s)`,
    `  hits      ${summary.hits.length}${summary.hits.length ? ': ' + summary.hits.map((hit) => `${hit.artist} (${hit.license})`).join(', ') : ''}`,
    `  rejected  ${summary.rejected.length} (licence)${summary.rejected.length ? ': ' + summary.rejected.map((item) => `${item.artist} (${item.license ?? 'unknown'})`).join(', ') : ''}`,
    `  misses    ${summary.misses.length}${summary.misses.length ? ': ' + summary.misses.map((item) => `${item.artist} (${item.stage})`).join(', ') : ''}`,
    `  skipped   ${summary.skipped.length} already in the registry`,
  ];
  if (summary.hits.length > 0) {
    lines.push(`Review the pending entries in ${registryFile} (set review.status, by, at), then run media:validate and media:upload.`);
  }
  summary.text = lines.join('\n');
  log(summary.text);
  return summary;
}

// CLI wrappers -------------------------------------------------------------------------------------

type Values = Record<string, string | boolean | undefined>;

function parse(args: string[], options: ParseArgsConfig['options'], usage: string): Values {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
    if (parsed.positionals.length > 0) {
      throw new Error(`Unexpected argument "${parsed.positionals[0]}"`);
    }
    return parsed.values as Values;
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nUsage: ${usage}`);
  }
}

function stringOption(values: Values, name: string): string | undefined {
  return typeof values[name] === 'string' ? (values[name] as string) : undefined;
}

export const MEDIA_COMMANDS: Record<string, (args: string[], log: Log) => Promise<void>> = {
  'media:validate': async (args, log) => {
    const values = parse(args, { file: { type: 'string' } }, MEDIA_VALIDATE_USAGE);
    const result = await mediaValidate({ file: stringOption(values, 'file'), log });
    if (!result.ok) {
      throw new UsageError(`${errorsOf(result.issues).length} error(s) in ${result.file}.`);
    }
  },
  'media:upload': async (args, log) => {
    const values = parse(args, { 'dry-run': { type: 'boolean' }, file: { type: 'string' } }, MEDIA_UPLOAD_USAGE);
    await mediaUpload({ dryRun: values['dry-run'] === true, file: stringOption(values, 'file'), log });
  },
  'media:fetch-commons': async (args, log) => {
    const values = parse(
      args,
      {
        artist: { type: 'string' },
        'artist-id': { type: 'string' },
        wikidata: { type: 'string' },
        into: { type: 'string' },
        seed: { type: 'string' },
        limit: { type: 'string' },
        'user-agent': { type: 'string' },
      },
      MEDIA_FETCH_COMMONS_USAGE,
    );
    const seed = stringOption(values, 'seed');
    const artist = stringOption(values, 'artist');
    const artistId = stringOption(values, 'artist-id');
    const into = stringOption(values, 'into');
    const userAgent = stringOption(values, 'user-agent');
    if (seed && (artist || artistId || values.wikidata)) {
      throw new UsageError(`Use either --seed or --artist/--artist-id.\nUsage: ${MEDIA_FETCH_COMMONS_USAGE}`);
    }
    if (seed) {
      let limit: number | undefined;
      if (typeof values.limit === 'string') {
        limit = Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new UsageError('--limit must be a positive integer');
        }
      }
      await mediaFetchCommonsForSeed({ seedFile: seed, into, userAgent, limit, log });
      return;
    }
    if (!artist || !artistId) {
      throw new UsageError(`Usage: ${MEDIA_FETCH_COMMONS_USAGE}`);
    }
    const { result } = await mediaFetchCommons({ artist, artistId, wikidataId: stringOption(values, 'wikidata'), into, userAgent, log });
    if (!result.ok) {
      throw new UsageError(`No usable image for ${artist} (${result.stage}): ${result.reason}`);
    }
  },
};
