/**
 * Rules for `seed-data/media/registry.json` (docs in seed-data/media/README.md). Collects every
 * problem instead of stopping at the first one. Issues are plain `ValidationIssue`s; a subject-name
 * mismatch is the one non-blocking rule and carries `warning: true` (see `isError`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { readJsonFile, repoRoot } from '../env';
import type { ValidationIssue } from '../festival/types';
import { isUuid } from '../lib/uuid';
import { imageDimensions, MIME_EXTENSIONS, sha256Of, sniffMime, subjectKey } from './registry';
import {
  ALLOWED_LICENSES,
  ARTWORK_MAX_BYTES,
  ARTWORK_MAX_SIDE,
  ATTRIBUTION_REQUIRED,
  IMAGE_CREDIT_MAX_LENGTH,
  MEDIA_REGISTRY_VERSION,
  type LicenseId,
  type MediaEntry,
  type MediaRegistry,
  type MediaSubjectType,
} from './types';

export interface MediaValidationIssue extends ValidationIssue {
  /** Set on non-blocking issues (currently only a subject-name mismatch). */
  warning?: true;
}

export interface MediaSubject {
  type: MediaSubjectType;
  name: string;
}

/** Subject id (`artists.id` / `festivals.id`) to type and display name, from the seed files. */
export type SubjectMap = Map<string, MediaSubject>;

export interface ValidateRegistryOptions {
  /** Directory entry files are relative to (the registry's directory). */
  dir: string;
  subjects: SubjectMap;
}

export const MEDIA_SUBJECT_TYPES: readonly MediaSubjectType[] = ['artist', 'festival'];
export const MEDIA_SOURCE_KINDS = ['wikimedia-commons', 'organizer-permission', 'press-kit', 'generated', 'other'] as const;
export const MEDIA_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const MEDIA_MIMES = Object.keys(MIME_EXTENSIONS) as Array<MediaEntry['mime']>;

/** `<artists|festivals>/<uuid>.<jpg|png|webp>`: safe, relative, one level deep. */
export const MEDIA_FILE_PATTERN = /^(artists|festivals)\/([0-9a-f-]{36})\.(jpg|png|webp)$/;

const ENTRY_KEYS = [
  'subject_type', 'subject_id', 'subject_name', 'file', 'sha256', 'mime', 'width', 'height', 'source', 'license', 'review',
] as const;
const SOURCE_KEYS = ['kind', 'url', 'page_url', 'retrieved_at', 'note'] as const;
const LICENSE_KEYS = ['id', 'url', 'attribution'] as const;
const REVIEW_KEYS = ['status', 'by', 'at', 'note'] as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FOLDER_FOR_TYPE: Record<MediaSubjectType, string> = { artist: 'artists', festival: 'festivals' };

type Json = Record<string, unknown>;

class Collector {
  readonly issues: MediaValidationIssue[] = [];

  error(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  warn(path: string, message: string): void {
    this.issues.push({ path, message, warning: true });
  }

  object(value: unknown, path: string): Json | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.error(path, 'must be an object');
      return null;
    }
    return value as Json;
  }

  keys(value: Json, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.error(`${path}.${key}`, `unknown field (allowed: ${allowed.join(', ')})`);
      }
    }
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): value is T {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.error(path, `must be one of ${allowed.join(', ')}`);
      return false;
    }
    return true;
  }

  nonEmptyString(value: unknown, path: string): value is string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.error(path, 'must be a non-empty string');
      return false;
    }
    return true;
  }

  /** `null`, or undefined when `optional`, or a non-empty string. */
  nullableString(value: unknown, path: string, optional = false): void {
    if (value === null || (optional && value === undefined)) {
      return;
    }
    if (typeof value !== 'string') {
      this.error(path, optional ? 'must be a string or null' : 'must be a string or null (not omitted)');
    }
  }

  httpsOrNull(value: unknown, path: string, optional = false): void {
    if (value === null || (optional && value === undefined)) {
      return;
    }
    if (typeof value !== 'string' || !isHttpsUrl(value)) {
      this.error(path, 'must be an https:// URL or null');
    }
  }

  timestamp(value: unknown, path: string): void {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      this.error(path, 'must be an ISO 8601 timestamp');
    }
  }
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function validateSource(c: Collector, value: unknown, path: string): void {
  const source = c.object(value, path);
  if (!source) {
    return;
  }
  c.keys(source, path, SOURCE_KEYS);
  c.oneOf(source.kind, `${path}.kind`, MEDIA_SOURCE_KINDS);
  c.httpsOrNull(source.url, `${path}.url`);
  c.httpsOrNull(source.page_url, `${path}.page_url`, true);
  c.timestamp(source.retrieved_at, `${path}.retrieved_at`);
  c.nullableString(source.note, `${path}.note`, true);
}

function validateLicense(c: Collector, value: unknown, path: string): void {
  const license = c.object(value, path);
  if (!license) {
    return;
  }
  c.keys(license, path, LICENSE_KEYS);
  const idOk = c.oneOf(license.id, `${path}.id`, ALLOWED_LICENSES);
  c.httpsOrNull(license.url, `${path}.url`);
  if (license.attribution !== null && typeof license.attribution !== 'string') {
    c.error(`${path}.attribution`, 'must be a string or null');
    return;
  }
  const attribution = typeof license.attribution === 'string' ? license.attribution.trim() : '';
  if (typeof license.attribution === 'string' && attribution === '') {
    c.error(`${path}.attribution`, 'must not be blank (use null when the licence needs no credit)');
  }
  if (attribution.length > IMAGE_CREDIT_MAX_LENGTH) {
    c.error(`${path}.attribution`, `must be at most ${IMAGE_CREDIT_MAX_LENGTH} characters`);
  }
  if (idOk && ATTRIBUTION_REQUIRED.includes(license.id as LicenseId) && attribution === '') {
    c.error(`${path}.attribution`, `${license.id} requires attribution text (e.g. "Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons")`);
  }
}

function validateReview(c: Collector, value: unknown, path: string): string | null {
  const review = c.object(value, path);
  if (!review) {
    return null;
  }
  c.keys(review, path, REVIEW_KEYS);
  const statusOk = c.oneOf(review.status, `${path}.status`, MEDIA_REVIEW_STATUSES);
  c.nullableString(review.by, `${path}.by`);
  if (review.at !== null) {
    c.timestamp(review.at, `${path}.at`);
  }
  c.nullableString(review.note, `${path}.note`, true);
  if (statusOk && review.status === 'approved') {
    if (typeof review.by !== 'string' || review.by.trim() === '') {
      c.error(`${path}.by`, 'an approved entry records who approved it');
    }
    if (typeof review.at !== 'string') {
      c.error(`${path}.at`, 'an approved entry records when it was approved');
    }
  }
  return statusOk ? (review.status as string) : null;
}

function validateFile(c: Collector, entry: Json, path: string, dir: string, subjectType: string | null): void {
  if (typeof entry.file !== 'string' || !MEDIA_FILE_PATTERN.test(entry.file)) {
    c.error(`${path}.file`, 'must match <artists|festivals>/<uuid>.<jpg|png|webp>');
    return;
  }
  const [, folder, fileId, extension] = MEDIA_FILE_PATTERN.exec(entry.file) as RegExpExecArray;
  if (subjectType && FOLDER_FOR_TYPE[subjectType as MediaSubjectType] !== folder) {
    c.error(`${path}.file`, `a ${subjectType} image lives under ${FOLDER_FOR_TYPE[subjectType as MediaSubjectType]}/`);
  }
  if (typeof entry.subject_id === 'string' && fileId !== entry.subject_id) {
    c.error(`${path}.file`, 'must be named after subject_id');
  }
  if (typeof entry.mime === 'string' && MEDIA_MIMES.includes(entry.mime as MediaEntry['mime'])) {
    const expected = MIME_EXTENSIONS[entry.mime as MediaEntry['mime']];
    if (expected !== extension) {
      c.error(`${path}.file`, `extension .${extension} does not match mime ${entry.mime} (expected .${expected})`);
    }
  }

  const absolute = resolveInside(dir, entry.file);
  if (!absolute || !existsSync(absolute) || !statSync(absolute).isFile()) {
    c.error(`${path}.file`, `file not found: ${entry.file} (looked in ${dir})`);
    return;
  }
  const bytes = readFileSync(absolute);
  if (bytes.length > ARTWORK_MAX_BYTES) {
    c.error(`${path}.file`, `is ${bytes.length} bytes; the limit is ${ARTWORK_MAX_BYTES} (${ARTWORK_MAX_BYTES / (1024 * 1024)} MiB)`);
  }
  const sniffed = sniffMime(bytes);
  if (!sniffed) {
    c.error(`${path}.file`, 'is not a JPEG, PNG or WebP image');
  } else if (typeof entry.mime === 'string' && sniffed !== entry.mime) {
    c.error(`${path}.mime`, `file is ${sniffed}, not ${entry.mime}`);
  }
  if (typeof entry.sha256 === 'string' && SHA256_PATTERN.test(entry.sha256) && sha256Of(bytes) !== entry.sha256) {
    c.error(`${path}.sha256`, 'does not match the file (re-run media:fetch-commons or recompute the checksum)');
  }
  const size = imageDimensions(bytes);
  if (size) {
    if (Math.max(size.width, size.height) > ARTWORK_MAX_SIDE) {
      c.error(`${path}.file`, `is ${size.width}x${size.height}; the longest side must be at most ${ARTWORK_MAX_SIDE} px`);
    }
    for (const side of ['width', 'height'] as const) {
      const given = entry[side];
      if (typeof given === 'number' && Number.isInteger(given) && given >= 1 && given !== size[side]) {
        c.error(`${path}.${side}`, `is ${String(entry[side])} but the file is ${size[side]} px`);
      }
    }
  }
}

/** Resolves `file` under `dir` and refuses anything that escapes it (the pattern already forbids `..`). */
function resolveInside(dir: string, file: string): string | null {
  const root = path.resolve(dir);
  const absolute = path.resolve(root, file);
  return absolute.startsWith(root + path.sep) ? absolute : null;
}

function validateSide(c: Collector, value: unknown, path: string): void {
  if (value === null) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    c.error(path, 'must be a positive integer or null');
    return;
  }
  if (value > ARTWORK_MAX_SIDE) {
    c.error(path, `must be at most ${ARTWORK_MAX_SIDE} px (the pipeline stores thumbnails, not originals)`);
  }
}

function validateEntry(c: Collector, value: unknown, path: string, options: ValidateRegistryOptions): { subject: string | null; approved: boolean } {
  const entry = c.object(value, path);
  if (!entry) {
    return { subject: null, approved: false };
  }
  c.keys(entry, path, ENTRY_KEYS);

  const typeOk = c.oneOf(entry.subject_type, `${path}.subject_type`, MEDIA_SUBJECT_TYPES);
  const idOk = isUuid(entry.subject_id);
  if (!idOk) {
    c.error(`${path}.subject_id`, 'must be a UUID (artists.id or festivals.id)');
  }
  const nameOk = c.nonEmptyString(entry.subject_name, `${path}.subject_name`);

  if (typeOk && idOk) {
    const subject = options.subjects.get(entry.subject_id as string);
    if (!subject) {
      c.error(`${path}.subject_id`, `no ${entry.subject_type} with this id in the seed files`);
    } else if (subject.type !== entry.subject_type) {
      c.error(`${path}.subject_type`, `${entry.subject_id} is a ${subject.type}, not a ${entry.subject_type}`);
    } else if (nameOk && normalizeName(subject.name) !== normalizeName(entry.subject_name as string)) {
      c.warn(`${path}.subject_name`, `"${entry.subject_name}" differs from the seed name "${subject.name}"`);
    }
  }

  if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
    c.error(`${path}.sha256`, 'must be 64 lowercase hex characters');
  }
  c.oneOf(entry.mime, `${path}.mime`, MEDIA_MIMES);
  validateSide(c, entry.width, `${path}.width`);
  validateSide(c, entry.height, `${path}.height`);
  validateFile(c, entry, path, options.dir, typeOk ? (entry.subject_type as string) : null);
  validateSource(c, entry.source, `${path}.source`);
  validateLicense(c, entry.license, `${path}.license`);
  const status = validateReview(c, entry.review, `${path}.review`);

  return {
    subject: typeOk && idOk ? subjectKey(entry.subject_type as MediaSubjectType, entry.subject_id as string) : null,
    approved: status === 'approved',
  };
}

/**
 * Validates a registry (any JSON value) against the rules in seed-data/media/README.md. Files are read
 * from `options.dir`; subjects come from `loadSubjects`. The result is ordered by entry.
 */
export function validateRegistry(registry: unknown, options: ValidateRegistryOptions): MediaValidationIssue[] {
  const c = new Collector();
  const root = c.object(registry, '$');
  if (!root) {
    return c.issues;
  }
  c.keys(root, '$', ['version', 'entries']);
  if (root.version !== MEDIA_REGISTRY_VERSION) {
    c.error('version', `must be ${MEDIA_REGISTRY_VERSION}`);
  }
  if (!Array.isArray(root.entries)) {
    c.error('entries', 'must be an array');
    return c.issues;
  }

  const approvedBySubject = new Map<string, number>();
  root.entries.forEach((value, index) => {
    const path = `entries[${index}]`;
    const { subject, approved } = validateEntry(c, value, path, options);
    if (subject && approved) {
      const first = approvedBySubject.get(subject);
      if (first !== undefined) {
        c.error(`${path}.review.status`, `a second approved entry for ${subject.replace(':', ' ')} (see entries[${first}]); reject one`);
      } else {
        approvedBySubject.set(subject, index);
      }
    }
  });
  return c.issues;
}

export function isError(issue: MediaValidationIssue): boolean {
  return issue.warning !== true;
}

export function errorsOf(issues: MediaValidationIssue[]): MediaValidationIssue[] {
  return issues.filter(isError);
}

export function warningsOf(issues: MediaValidationIssue[]): MediaValidationIssue[] {
  return issues.filter((issue) => !isError(issue));
}

/** Whether `entries[index]` has a blocking issue. */
export function entryHasErrors(issues: MediaValidationIssue[], index: number): boolean {
  const prefix = `entries[${index}]`;
  return issues.some((issue) => isError(issue) && (issue.path === prefix || issue.path.startsWith(`${prefix}.`)));
}

export function formatMediaIssues(issues: MediaValidationIssue[]): string {
  return issues.map((issue) => `  - ${issue.path}: ${issue.message}${issue.warning ? ' (warning)' : ''}`).join('\n');
}

interface SeedLike {
  festival?: { id?: unknown; name?: unknown };
  artists?: Array<{ id?: unknown; name?: unknown }>;
}

export interface SubjectSource {
  /** Where the list of seed files came from. */
  from: 'golden-index' | 'scan';
  files: string[];
}

export function defaultSeedDataDir(): string {
  return path.join(repoRoot(), 'seed-data');
}

/**
 * The festival seed files that define subjects: those listed in `golden/index.json` when it exists,
 * otherwise every `*.json` directly under the seed-data directory.
 */
export function listSubjectFiles(seedDataDir: string = defaultSeedDataDir()): SubjectSource {
  const indexFile = path.join(seedDataDir, 'golden', 'index.json');
  if (existsSync(indexFile)) {
    const index = readJsonFile(indexFile) as { festivals?: Array<{ seed_file?: unknown }> };
    const files: string[] = [];
    for (const festival of index.festivals ?? []) {
      if (typeof festival.seed_file !== 'string') {
        continue;
      }
      const resolved = resolveSeedFile(seedDataDir, festival.seed_file);
      if (resolved) {
        files.push(resolved);
      }
    }
    return { from: 'golden-index', files };
  }
  const files = readdirSync(seedDataDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(seedDataDir, name));
  return { from: 'scan', files };
}

/** `seed_file` may be relative to the repo root (`seed-data/x.json`), to seed-data, or just a name. */
function resolveSeedFile(seedDataDir: string, seedFile: string): string | null {
  const candidates = path.isAbsolute(seedFile)
    ? [seedFile]
    : [path.resolve(path.dirname(seedDataDir), seedFile), path.resolve(seedDataDir, seedFile), path.resolve(seedDataDir, path.basename(seedFile))];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Adds a seed file's festival and artists to `subjects` (later files win on a duplicate id). */
export function addSubjectsFromSeed(subjects: SubjectMap, seed: unknown): void {
  const data = seed as SeedLike;
  if (typeof data !== 'object' || data === null) {
    return;
  }
  if (isUuid(data.festival?.id) && typeof data.festival?.name === 'string') {
    subjects.set(data.festival.id, { type: 'festival', name: data.festival.name });
  }
  for (const artist of Array.isArray(data.artists) ? data.artists : []) {
    if (isUuid(artist?.id) && typeof artist?.name === 'string') {
      subjects.set(artist.id, { type: 'artist', name: artist.name });
    }
  }
}

export function loadSubjects(seedDataDir: string = defaultSeedDataDir()): SubjectMap {
  const subjects: SubjectMap = new Map();
  for (const file of listSubjectFiles(seedDataDir).files) {
    addSubjectsFromSeed(subjects, readJsonFile(file));
  }
  return subjects;
}
