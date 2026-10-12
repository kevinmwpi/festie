/**
 * `media:upload`: pushes approved registry entries to the public `artwork` bucket (migration 013) and
 * writes the subject rows' image columns (migration 012), clears subjects that lost their approval, and
 * bumps `festivals.version` so clients refetch (they only refetch a festival's artists when its version
 * changes). Planning is read-only; `applyMediaUpload` performs the plan in a safe order:
 * uploads, row updates, row clears, object removals, version bumps.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../env';
import { md5Of } from './registry';
import {
  ARTWORK_BUCKET,
  artworkPublicUrl,
  type MediaEntry,
  type MediaRegistry,
  type MediaSubjectType,
} from './types';
import { entryHasErrors, isError, MEDIA_FILE_PATTERN, validateRegistry, type SubjectMap } from './validate';

export const IMAGE_COLUMNS = ['image_url', 'image_credit', 'image_license', 'image_source_url'] as const;

export interface ImageColumns {
  image_url: string | null;
  image_credit: string | null;
  image_license: string | null;
  image_source_url: string | null;
}

export const CLEARED_IMAGE_COLUMNS: Readonly<ImageColumns> = {
  image_url: null,
  image_credit: null,
  image_license: null,
  image_source_url: null,
};

export type SubjectTable = 'artists' | 'festivals';
export const TABLE_FOR_TYPE: Readonly<Record<MediaSubjectType, SubjectTable>> = { artist: 'artists', festival: 'festivals' };

/** Storage's `remove()` accepts at most 1000 paths per call; `in()` filters stay well below URL limits. */
const REMOVE_BATCH_SIZE = 1000;
const IN_CHUNK_SIZE = 200;
const PAGE_SIZE = 1000;

export interface SubjectRow extends ImageColumns {
  id: string;
  name: string;
  /** Festivals only. */
  status: string | null;
  version: number | null;
}

export type UploadReason = 'missing' | 'changed' | 'checksum unknown';

export interface PlannedUpload {
  entry: MediaEntry;
  path: string;
  contentType: MediaEntry['mime'];
  bytes: Buffer;
  reason: UploadReason;
}

export interface PlannedRowUpdate {
  table: SubjectTable;
  id: string;
  name: string;
  before: ImageColumns;
  after: ImageColumns;
}

export interface PlannedClear {
  table: SubjectTable;
  id: string;
  name: string;
  before: ImageColumns;
  /** The bucket object the row pointed at (null when the URL is not a registry-shaped path). */
  objectPath: string | null;
}

export interface PlannedBump {
  festivalId: string;
  name: string;
  /** Version at planning time; the apply step re-reads it. */
  version: number;
  reasons: string[];
}

export interface SkippedEntry {
  index: number;
  entry: MediaEntry;
  reason: string;
}

export interface MissingRow {
  table: SubjectTable;
  id: string;
  name: string;
}

export interface MediaUploadPlan {
  bucket: string;
  supabaseUrl: string;
  /** Approved entries that passed validation. */
  approved: number;
  uploads: PlannedUpload[];
  /** Approved entries whose object already holds the same bytes. */
  unchangedObjects: number;
  rowUpdates: PlannedRowUpdate[];
  /** Rows pointing at our bucket without an approved entry: image columns are cleared. */
  clears: PlannedClear[];
  /** Objects to delete: cleared subjects' objects plus objects no approved entry references. */
  removals: string[];
  bumps: PlannedBump[];
  /** Festivals touched (own image or an artist's) that are not published: no bump needed. */
  unpublishedTouched: Array<{ festivalId: string; name: string; status: string | null }>;
  skipped: SkippedEntry[];
  /** Approved entries whose subject row is not in the database (seed the festival first). */
  missingRows: MissingRow[];
}

export interface MediaApplyResult {
  uploaded: number;
  updated: number;
  cleared: number;
  removed: number;
  bumped: Array<{ festivalId: string; from: number; to: number }>;
}

/** What `media:upload` writes on the subject row for an approved entry. */
export function imageColumnsFor(entry: MediaEntry, supabaseUrl: string): ImageColumns {
  const credit = entry.license.attribution?.trim() ?? '';
  return {
    image_url: artworkPublicUrl(supabaseUrl, entry.file),
    image_credit: credit === '' ? null : credit,
    image_license: entry.license.id,
    image_source_url: entry.source.url,
  };
}

export function sameImageColumns(a: ImageColumns, b: ImageColumns): boolean {
  return IMAGE_COLUMNS.every((column) => (a[column] ?? null) === (b[column] ?? null));
}

/** The registry path behind one of our public URLs, or null when it is not ours. */
export function objectPathOf(imageUrl: string | null, supabaseUrl: string): string | null {
  if (!imageUrl) {
    return null;
  }
  const prefix = artworkPublicUrl(supabaseUrl, '');
  if (!imageUrl.startsWith(prefix)) {
    return null;
  }
  let rest = imageUrl.slice(prefix.length).split(/[?#]/)[0];
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return MEDIA_FILE_PATTERN.test(rest) ? rest : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function columnsOf(table: SubjectTable): string {
  const base = `id, name, ${IMAGE_COLUMNS.join(', ')}`;
  return table === 'festivals' ? `${base}, status, version` : base;
}

function toSubjectRow(raw: Record<string, unknown>): SubjectRow {
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name : '',
    image_url: (raw.image_url as string | null) ?? null,
    image_credit: (raw.image_credit as string | null) ?? null,
    image_license: (raw.image_license as string | null) ?? null,
    image_source_url: (raw.image_source_url as string | null) ?? null,
    status: typeof raw.status === 'string' ? raw.status : null,
    version: typeof raw.version === 'number' ? raw.version : null,
  };
}

async function fetchRowsByIds(client: SupabaseClient, table: SubjectTable, ids: string[]): Promise<SubjectRow[]> {
  const rows: SubjectRow[] = [];
  for (const part of chunk([...new Set(ids)], IN_CHUNK_SIZE)) {
    const page = check(
      await client.from(table).select(columnsOf(table)).in('id', part),
      `Reading ${table}`,
    ) as unknown as Record<string, unknown>[];
    rows.push(...page.map(toSubjectRow));
  }
  return rows;
}

/** Every row with an image (ours or not); paged with order + range like festival:seed. */
async function fetchRowsWithImages(client: SupabaseClient, table: SubjectTable): Promise<SubjectRow[]> {
  const rows: SubjectRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = check(
      await client
        .from(table)
        .select(columnsOf(table))
        .not('image_url', 'is', null)
        .order('id')
        .range(from, from + PAGE_SIZE - 1),
      `Reading ${table} with images`,
    ) as unknown as Record<string, unknown>[];
    rows.push(...page.map(toSubjectRow));
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

/** Festival ids that have a set by any of the artists, with the artist ids that caused it. */
async function festivalsUsingArtists(client: SupabaseClient, artistIds: string[]): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const part of chunk(artistIds, IN_CHUNK_SIZE)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = check(
        await client
          .from('sets')
          .select('id, festival_id, artist_id')
          .in('artist_id', part)
          .order('id')
          .range(from, from + PAGE_SIZE - 1),
        'Reading sets',
      ) as Array<{ id: string; festival_id: string; artist_id: string }>;
      for (const row of page) {
        const artists = result.get(row.festival_id) ?? new Set<string>();
        artists.add(row.artist_id);
        result.set(row.festival_id, artists);
      }
      if (page.length < PAGE_SIZE) {
        break;
      }
    }
  }
  return result;
}

export interface StoredObject {
  path: string;
  size: number | null;
  /** MD5 of the body for single-part uploads (quotes stripped); null when unknown. */
  md5: string | null;
}

function md5FromETag(eTag: unknown): string | null {
  if (typeof eTag !== 'string') {
    return null;
  }
  const bare = eTag.replace(/^W\//, '').replace(/^"|"$/g, '');
  return /^[0-9a-f]{32}$/i.test(bare) ? bare.toLowerCase() : null;
}

/** Objects under `artists/` and `festivals/` (the only folders the registry writes). */
export async function listArtworkObjects(client: SupabaseClient, bucket = ARTWORK_BUCKET): Promise<Map<string, StoredObject>> {
  const objects = new Map<string, StoredObject>();
  for (const prefix of ['artists', 'festivals']) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) {
        throw new Error(`Listing ${bucket}/${prefix} failed: ${error.message}`);
      }
      const page = data ?? [];
      for (const entry of page) {
        if (entry.id === null) {
          continue; // a folder; the registry never nests
        }
        const size = Number(entry.metadata?.size);
        objects.set(`${prefix}/${entry.name}`, {
          path: `${prefix}/${entry.name}`,
          size: Number.isFinite(size) ? size : null,
          md5: md5FromETag(entry.metadata?.eTag),
        });
      }
      if (page.length < PAGE_SIZE) {
        break;
      }
    }
  }
  return objects;
}

/** The sha256 we stored as object metadata on upload, when the storage API exposes it. */
async function storedSha256(client: SupabaseClient, bucket: string, objectPath: string): Promise<string | null> {
  const api = client.storage.from(bucket) as { info?: (path: string) => Promise<{ data: unknown; error: unknown }> };
  if (typeof api.info !== 'function') {
    return null;
  }
  try {
    const { data, error } = await api.info(objectPath);
    if (error || !data) {
      return null;
    }
    const metadata = (data as { metadata?: Record<string, unknown> | null }).metadata;
    const sha = metadata?.sha256;
    return typeof sha === 'string' ? sha : null;
  } catch {
    return null;
  }
}

export interface PlanMediaUploadOptions {
  /** Directory entry files are relative to (the registry's directory). */
  dir: string;
  supabaseUrl: string;
  subjects: SubjectMap;
  bucket?: string;
}

export async function planMediaUpload(
  client: SupabaseClient,
  registry: MediaRegistry,
  options: PlanMediaUploadOptions,
): Promise<MediaUploadPlan> {
  const bucket = options.bucket ?? ARTWORK_BUCKET;
  const bucketPrefix = artworkPublicUrl(options.supabaseUrl, '');
  const issues = validateRegistry(registry, { dir: options.dir, subjects: options.subjects });

  const skipped: SkippedEntry[] = [];
  const approved: MediaEntry[] = [];
  registry.entries.forEach((entry, index) => {
    const status = entry?.review?.status;
    if (status !== 'approved') {
      skipped.push({ index, entry, reason: `${String(status ?? 'no status')} (not approved)` });
      return;
    }
    if (entryHasErrors(issues, index)) {
      const problems = issues
        .filter((issue) => isError(issue) && issue.path.startsWith(`entries[${index}]`))
        .map((issue) => `${issue.path.replace(`entries[${index}]`, '').replace(/^\./, '') || '$'}: ${issue.message}`);
      skipped.push({ index, entry, reason: `invalid: ${problems.join('; ')}` });
      return;
    }
    approved.push(entry);
  });

  // Storage: what to (re)upload.
  const stored = await listArtworkObjects(client, bucket);
  const uploads: PlannedUpload[] = [];
  let unchangedObjects = 0;
  const approvedFiles = new Set(approved.map((entry) => entry.file));
  for (const entry of approved) {
    const bytes = readFileSync(path.join(options.dir, entry.file));
    const object = stored.get(entry.file);
    let reason: UploadReason | null;
    if (!object) {
      reason = 'missing';
    } else if (object.md5 && object.md5 === md5Of(bytes)) {
      reason = null;
    } else {
      const sha = await storedSha256(client, bucket, entry.file);
      reason = sha === null ? 'checksum unknown' : sha === entry.sha256 ? null : 'changed';
    }
    if (reason) {
      uploads.push({ entry, path: entry.file, contentType: entry.mime, bytes, reason });
    } else {
      unchangedObjects += 1;
    }
  }

  // Rows: updates for approved entries, clears for rows that point at our bucket without one.
  const rowUpdates: PlannedRowUpdate[] = [];
  const clears: PlannedClear[] = [];
  const missingRows: MissingRow[] = [];
  const festivalRows = new Map<string, SubjectRow>();
  const changedArtists = new Map<string, string>();
  const changedFestivals = new Map<string, string>();
  for (const table of ['artists', 'festivals'] as const) {
    const type: MediaSubjectType = table === 'artists' ? 'artist' : 'festival';
    const entries = approved.filter((entry) => entry.subject_type === type);
    const byId = new Map(entries.map((entry) => [entry.subject_id, entry]));
    const rows = new Map<string, SubjectRow>();
    for (const row of await fetchRowsByIds(client, table, [...byId.keys()])) {
      rows.set(row.id, row);
    }
    for (const row of await fetchRowsWithImages(client, table)) {
      rows.set(row.id, row);
    }
    if (table === 'festivals') {
      for (const row of rows.values()) {
        festivalRows.set(row.id, row);
      }
    }
    for (const [id, entry] of byId) {
      const row = rows.get(id);
      if (!row) {
        missingRows.push({ table, id, name: entry.subject_name });
        continue;
      }
      const after = imageColumnsFor(entry, options.supabaseUrl);
      if (!sameImageColumns(row, after)) {
        rowUpdates.push({ table, id, name: row.name || entry.subject_name, before: pickImageColumns(row), after });
        (table === 'artists' ? changedArtists : changedFestivals).set(id, row.name || entry.subject_name);
      }
    }
    for (const row of rows.values()) {
      const ours = row.image_url?.startsWith(bucketPrefix) ?? false;
      if (byId.has(row.id) || !ours) {
        continue;
      }
      clears.push({ table, id: row.id, name: row.name, before: pickImageColumns(row), objectPath: objectPathOf(row.image_url, options.supabaseUrl) });
      (table === 'artists' ? changedArtists : changedFestivals).set(row.id, row.name);
    }
  }

  // Objects to remove: cleared rows' objects and anything in the bucket no approved entry references.
  const removals = new Set<string>();
  for (const clear of clears) {
    if (clear.objectPath && !approvedFiles.has(clear.objectPath)) {
      removals.add(clear.objectPath);
    }
  }
  for (const objectPath of stored.keys()) {
    if (!approvedFiles.has(objectPath)) {
      removals.add(objectPath);
    }
  }

  // Version bumps: published festivals whose own image changed or that have a set by a changed artist.
  const reasons = new Map<string, string[]>();
  for (const [festivalId, name] of changedFestivals) {
    reasons.set(festivalId, [`image of ${name} changed`]);
  }
  if (changedArtists.size > 0) {
    for (const [festivalId, artistIds] of await festivalsUsingArtists(client, [...changedArtists.keys()])) {
      const list = reasons.get(festivalId) ?? [];
      for (const artistId of artistIds) {
        list.push(`image of artist ${changedArtists.get(artistId) ?? artistId} changed`);
      }
      reasons.set(festivalId, list);
    }
  }
  const unknownFestivals = [...reasons.keys()].filter((id) => !festivalRows.has(id));
  for (const row of await fetchRowsByIds(client, 'festivals', unknownFestivals)) {
    festivalRows.set(row.id, row);
  }
  const bumps: PlannedBump[] = [];
  const unpublishedTouched: MediaUploadPlan['unpublishedTouched'] = [];
  for (const [festivalId, list] of reasons) {
    const row = festivalRows.get(festivalId);
    if (!row) {
      continue; // the set's festival vanished meanwhile; nothing to bump
    }
    if (row.status === 'published') {
      bumps.push({ festivalId, name: row.name, version: row.version ?? 0, reasons: list });
    } else {
      unpublishedTouched.push({ festivalId, name: row.name, status: row.status });
    }
  }

  return {
    bucket,
    supabaseUrl: options.supabaseUrl,
    approved: approved.length,
    uploads,
    unchangedObjects,
    rowUpdates,
    clears,
    removals: [...removals].sort(),
    bumps: bumps.sort((a, b) => a.name.localeCompare(b.name)),
    unpublishedTouched,
    skipped,
    missingRows,
  };
}

function pickImageColumns(row: ImageColumns): ImageColumns {
  return {
    image_url: row.image_url,
    image_credit: row.image_credit,
    image_license: row.image_license,
    image_source_url: row.image_source_url,
  };
}

export function planIsEmpty(plan: MediaUploadPlan): boolean {
  return plan.uploads.length === 0 && plan.rowUpdates.length === 0 && plan.clears.length === 0 && plan.removals.length === 0 && plan.bumps.length === 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function describeMediaPlan(plan: MediaUploadPlan): string {
  const lines = [
    `Bucket "${plan.bucket}" at ${plan.supabaseUrl}: ${plan.approved} approved entr${plan.approved === 1 ? 'y' : 'ies'}, ` +
      `${plan.unchangedObjects} object(s) already up to date`,
    `  upload  ${plan.uploads.length} object(s)`,
  ];
  for (const upload of plan.uploads) {
    lines.push(`      ${upload.path}  ${upload.entry.subject_name} (${upload.reason}, ${formatBytes(upload.bytes.length)}, ${upload.entry.license.id})`);
  }
  lines.push(`  rows    ${plan.rowUpdates.length} update(s)`);
  for (const update of plan.rowUpdates) {
    const changed = IMAGE_COLUMNS.filter((column) => (update.before[column] ?? null) !== (update.after[column] ?? null));
    lines.push(`      ${update.table} ${update.id} ${update.name}: ${changed.join(', ')}`);
  }
  lines.push(`  clear   ${plan.clears.length} row(s) whose image has no approved entry any more`);
  for (const clear of plan.clears) {
    lines.push(`      ${clear.table} ${clear.id} ${clear.name}: ${clear.before.image_url ?? ''}`);
  }
  lines.push(`  remove  ${plan.removals.length} object(s)`);
  for (const objectPath of plan.removals) {
    lines.push(`      ${objectPath}`);
  }
  lines.push(`  bump    ${plan.bumps.length} published festival(s)`);
  for (const bump of plan.bumps) {
    lines.push(`      ${bump.name} (${bump.festivalId}) version ${bump.version} -> ${bump.version + 1}: ${bump.reasons.join('; ')}`);
  }
  for (const touched of plan.unpublishedTouched) {
    lines.push(`      ${touched.name} (${touched.festivalId}) is ${touched.status ?? 'unknown'}, not bumped (festival:seed bumps it on publish)`);
  }
  if (plan.missingRows.length > 0) {
    lines.push(`  WARNING ${plan.missingRows.length} approved entr${plan.missingRows.length === 1 ? 'y has' : 'ies have'} no database row (seed the festival first):`);
    for (const missing of plan.missingRows) {
      lines.push(`      ${missing.table} ${missing.id} ${missing.name}`);
    }
  }
  if (plan.skipped.length > 0) {
    lines.push(`  skipped ${plan.skipped.length} entr${plan.skipped.length === 1 ? 'y' : 'ies'}`);
    for (const item of plan.skipped) {
      lines.push(`      entries[${item.index}] ${item.entry?.subject_name ?? '?'}: ${item.reason}`);
    }
  }
  if (planIsEmpty(plan)) {
    lines.push('Nothing to do.');
  }
  return lines.join('\n');
}

/**
 * Performs the plan. Order matters for clients: objects exist before rows point at them, rows stop
 * pointing at objects before those are removed, and versions bump last so a refetch sees everything.
 */
export async function applyMediaUpload(
  client: SupabaseClient,
  plan: MediaUploadPlan,
  log: (line: string) => void = () => {},
): Promise<MediaApplyResult> {
  const result: MediaApplyResult = { uploaded: 0, updated: 0, cleared: 0, removed: 0, bumped: [] };
  const storage = client.storage.from(plan.bucket);

  for (const upload of plan.uploads) {
    const { error } = await storage.upload(upload.path, upload.bytes, {
      contentType: upload.contentType,
      upsert: true,
      metadata: { sha256: upload.entry.sha256 },
    });
    if (error) {
      throw new Error(`Uploading ${plan.bucket}/${upload.path} failed after ${result.uploaded} upload(s): ${error.message}`);
    }
    result.uploaded += 1;
    log(`Uploaded ${upload.path} (${upload.entry.subject_name}).`);
  }

  for (const update of plan.rowUpdates) {
    check(await client.from(update.table).update(update.after).eq('id', update.id), `Updating ${update.table} ${update.id}`);
    result.updated += 1;
  }
  if (plan.rowUpdates.length > 0) {
    log(`Updated ${plan.rowUpdates.length} row(s).`);
  }

  for (const clear of plan.clears) {
    check(
      await client.from(clear.table).update({ ...CLEARED_IMAGE_COLUMNS }).eq('id', clear.id),
      `Clearing image of ${clear.table} ${clear.id}`,
    );
    result.cleared += 1;
  }
  if (plan.clears.length > 0) {
    log(`Cleared ${plan.clears.length} row(s).`);
  }

  for (const [index, batch] of chunk(plan.removals, REMOVE_BATCH_SIZE).entries()) {
    const { data, error } = await storage.remove(batch);
    if (error) {
      throw new Error(`Removing objects (batch ${index + 1}) failed after ${result.removed} removal(s): ${error.message}`);
    }
    result.removed += data?.length ?? batch.length;
  }
  if (plan.removals.length > 0) {
    log(`Removed ${result.removed} object(s).`);
  }

  for (const bump of plan.bumps) {
    const current = check(
      await client.from('festivals').select('id, version').eq('id', bump.festivalId).maybeSingle(),
      `Reading festival ${bump.festivalId}`,
    ) as { id: string; version: number } | null;
    if (!current) {
      log(`Festival ${bump.festivalId} no longer exists; not bumped.`);
      continue;
    }
    const next = (current.version ?? 0) + 1;
    check(
      await client
        .from('festivals')
        .update({ version: next, updated_at: new Date().toISOString() })
        .eq('id', bump.festivalId),
      `Bumping festival ${bump.festivalId}`,
    );
    result.bumped.push({ festivalId: bump.festivalId, from: current.version, to: next });
    log(`Bumped ${bump.name} to version ${next}.`);
  }
  return result;
}
