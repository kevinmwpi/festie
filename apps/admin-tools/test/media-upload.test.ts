import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';

import { MEDIA_COMMANDS, mediaUpload } from '../src/media/command';
import { md5Of, sha256Of, writeRegistry } from '../src/media/registry';
import { artworkPublicUrl, type MediaEntry, type MediaRegistry } from '../src/media/types';
import {
  applyMediaUpload,
  describeMediaPlan,
  imageColumnsFor,
  objectPathOf,
  planMediaUpload,
  type ImageColumns,
  type MediaUploadPlan,
} from '../src/media/upload';
import type { SubjectMap } from '../src/media/validate';
import { tinyJpeg, tinyPng } from './media-fixtures';

const URL = 'https://xyz.supabase.co';
const F1 = '11111111-1111-4111-8111-111111111111';
const F2 = '11111111-1111-4111-8111-111111111112';
const F3 = '11111111-1111-4111-8111-111111111113';
const A1 = '33333333-3333-4333-8333-333333333331';
const A2 = '33333333-3333-4333-8333-333333333332';
const JPEG = tinyJpeg(400, 300);
const PNG = tinyPng(2, 2);

type Row = Record<string, unknown>;

interface Tables {
  artists: Row[];
  festivals: Row[];
  sets: Row[];
}

interface StoredFake {
  md5?: string;
  sha256?: string | null;
  /** When true `info()` fails (older storage API). */
  noInfo?: boolean;
}

/** In-memory PostgREST + storage fake covering the builder calls media:upload makes. */
function fakeClient(tables: Tables, objects: Record<string, StoredFake> = {}) {
  const calls: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        expect(bucket).toBe('artwork');
        return {
          async list(prefix: string, options: { limit: number; offset: number }) {
            calls.push(`list:${prefix}@${options.offset}`);
            const data = Object.entries(objects)
              .filter(([key]) => key.startsWith(`${prefix}/`))
              .map(([key, value]) => ({
                name: key.slice(prefix.length + 1),
                id: `id-${key}`,
                created_at: '2026-10-01T00:00:00Z',
                updated_at: null,
                last_accessed_at: null,
                metadata: { size: 10, eTag: value.md5 ? `"${value.md5}"` : undefined },
              }))
              .slice(options.offset, options.offset + options.limit);
            return { data, error: null };
          },
          async info(objectPath: string) {
            calls.push(`info:${objectPath}`);
            const object = objects[objectPath];
            if (!object || object.noInfo) {
              return { data: null, error: { message: 'not found' } };
            }
            return { data: { name: objectPath, metadata: object.sha256 ? { sha256: object.sha256 } : {} }, error: null };
          },
          async upload(objectPath: string, body: Buffer, options: Record<string, unknown>) {
            calls.push(`upload:${objectPath}:${options.contentType}:${options.upsert}:${(options.metadata as { sha256: string }).sha256.slice(0, 8)}:${body.length}`);
            return { data: { path: objectPath }, error: null };
          },
          async remove(paths: string[]) {
            calls.push(`remove:${paths.join(',')}`);
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
    from(table: keyof Tables) {
      const state = {
        op: 'select' as 'select' | 'update',
        values: {} as Row,
        filters: [] as Array<(row: Row) => boolean>,
        range: null as [number, number] | null,
        single: false,
      };
      const run = () => {
        let rows = tables[table].filter((row) => state.filters.every((filter) => filter(row)));
        if (state.op === 'update') {
          for (const row of rows) {
            Object.assign(row, state.values);
          }
          calls.push(`update:${table}:${rows.map((row) => row.id).join(',')}:${JSON.stringify(state.values)}`);
          return { data: null, error: null };
        }
        rows = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (state.range) {
          rows = rows.slice(state.range[0], state.range[1] + 1);
        }
        calls.push(`select:${table}:${rows.length}`);
        return { data: state.single ? (rows[0] ? { ...rows[0] } : null) : rows.map((row) => ({ ...row })), error: null };
      };
      const builder = {
        select: () => builder,
        update(values: Row) {
          state.op = 'update';
          state.values = values;
          return builder;
        },
        in(column: string, values: unknown[]) {
          state.filters.push((row) => values.includes(row[column]));
          return builder;
        },
        eq(column: string, value: unknown) {
          state.filters.push((row) => row[column] === value);
          return builder;
        },
        not(column: string, op: string, value: unknown) {
          expect([op, value]).toEqual(['is', null]);
          state.filters.push((row) => row[column] !== null && row[column] !== undefined);
          return builder;
        },
        order: () => builder,
        range(from: number, to: number) {
          state.range = [from, to];
          return builder;
        },
        maybeSingle() {
          state.single = true;
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          resolve(run());
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls, tables };
}

const NO_IMAGE: ImageColumns = { image_url: null, image_credit: null, image_license: null, image_source_url: null };

function artistRow(id: string, name: string, image: Partial<ImageColumns> = {}): Row {
  return { id, name, ...NO_IMAGE, ...image };
}

function festivalRow(id: string, name: string, status: string, version: number, image: Partial<ImageColumns> = {}): Row {
  return { id, name, status, version, ...NO_IMAGE, ...image };
}

function tablesWithSets(): Tables {
  return {
    artists: [artistRow(A1, 'Artist One'), artistRow(A2, 'Artist Two')],
    festivals: [festivalRow(F1, 'Riverside Sounds', 'published', 3), festivalRow(F2, 'Draft Fest', 'draft', 1), festivalRow(F3, 'Other Fest', 'published', 7)],
    sets: [
      { id: 's1', festival_id: F1, artist_id: A1 },
      { id: 's2', festival_id: F1, artist_id: A2 },
      { id: 's3', festival_id: F2, artist_id: A1 },
      { id: 's4', festival_id: F3, artist_id: A2 },
    ],
  };
}

function subjects(): SubjectMap {
  return new Map([
    [F1, { type: 'festival' as const, name: 'Riverside Sounds' }],
    [F2, { type: 'festival' as const, name: 'Draft Fest' }],
    [F3, { type: 'festival' as const, name: 'Other Fest' }],
    [A1, { type: 'artist' as const, name: 'Artist One' }],
    [A2, { type: 'artist' as const, name: 'Artist Two' }],
  ]);
}

function approvedArtist(overrides: Partial<MediaEntry> = {}): MediaEntry {
  return {
    subject_type: 'artist',
    subject_id: A1,
    subject_name: 'Artist One',
    file: `artists/${A1}.jpg`,
    sha256: sha256Of(JPEG),
    mime: 'image/jpeg',
    width: 400,
    height: 300,
    source: { kind: 'wikimedia-commons', url: 'https://commons.wikimedia.org/wiki/File:Artist_One.jpg', page_url: 'https://www.wikidata.org/wiki/Q1', retrieved_at: '2026-10-01T10:00:00Z', note: null },
    license: { id: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons' },
    review: { status: 'approved', by: 'kev', at: '2026-10-02T10:00:00Z', note: null },
    ...overrides,
  };
}

function approvedFestival(): MediaEntry {
  return approvedArtist({
    subject_type: 'festival',
    subject_id: F1,
    subject_name: 'Riverside Sounds',
    file: `festivals/${F1}.png`,
    sha256: sha256Of(PNG),
    mime: 'image/png',
    width: 2,
    height: 2,
    source: { kind: 'organizer-permission', url: null, retrieved_at: '2026-10-01T10:00:00Z', note: 'Permission email on file' },
    license: { id: 'organizer-permission', url: null, attribution: 'Photo courtesy of Riverside Sounds' },
  });
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function mediaDir(files: Record<string, Buffer> = { [`artists/${A1}.jpg`]: JPEG, [`festivals/${F1}.png`]: PNG }): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'festie-media-upload-'));
  dirs.push(dir);
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), bytes);
  }
  return dir;
}

function plan(client: SupabaseClient, entries: MediaEntry[], dir = mediaDir()): Promise<MediaUploadPlan> {
  return planMediaUpload(client, { version: 1, entries }, { dir, supabaseUrl: URL, subjects: subjects() });
}

const A1_URL = artworkPublicUrl(URL, `artists/${A1}.jpg`);
const A1_COLUMNS = {
  image_url: A1_URL,
  image_credit: 'Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons',
  image_license: 'CC-BY-SA-4.0',
  image_source_url: 'https://commons.wikimedia.org/wiki/File:Artist_One.jpg',
};

describe('imageColumnsFor and objectPathOf', () => {
  it('maps an entry to the row columns and back to the object path', () => {
    expect(imageColumnsFor(approvedArtist(), URL)).toEqual(A1_COLUMNS);
    expect(imageColumnsFor(approvedArtist({ license: { id: 'CC0-1.0', url: null, attribution: '  ' } }), `${URL}/`).image_credit).toBeNull();
    expect(objectPathOf(A1_URL, URL)).toBe(`artists/${A1}.jpg`);
    expect(objectPathOf(`${A1_URL}?v=2`, URL)).toBe(`artists/${A1}.jpg`);
    expect(objectPathOf('https://example.org/photo.jpg', URL)).toBeNull();
    expect(objectPathOf(`${URL}/storage/v1/object/public/artwork/other/x.jpg`, URL)).toBeNull();
    expect(objectPathOf(null, URL)).toBeNull();
  });
});

describe('planMediaUpload', () => {
  it('plans a new upload, the row update and a version bump of the published festivals using the artist', async () => {
    const { client } = fakeClient(tablesWithSets());
    const result = await plan(client, [approvedArtist()]);

    expect(result.approved).toBe(1);
    expect(result.uploads.map((upload) => [upload.path, upload.reason, upload.contentType])).toEqual([[`artists/${A1}.jpg`, 'missing', 'image/jpeg']]);
    expect(result.uploads[0].bytes.equals(JPEG)).toBe(true);
    expect(result.rowUpdates).toEqual([{ table: 'artists', id: A1, name: 'Artist One', before: NO_IMAGE, after: A1_COLUMNS }]);
    expect(result.clears).toEqual([]);
    expect(result.removals).toEqual([]);
    expect(result.bumps).toEqual([{ festivalId: F1, name: 'Riverside Sounds', version: 3, reasons: ['image of artist Artist One changed'] }]);
    expect(result.unpublishedTouched).toEqual([{ festivalId: F2, name: 'Draft Fest', status: 'draft' }]);
    expect(result.missingRows).toEqual([]);
    expect(result.skipped).toEqual([]);

    const text = describeMediaPlan(result);
    expect(text).toContain('1 approved entry, 0 object(s) already up to date');
    expect(text).toContain(`artists/${A1}.jpg  Artist One (missing, `);
    expect(text).toContain(`artists ${A1} Artist One: image_url, image_credit, image_license, image_source_url`);
    expect(text).toContain(`Riverside Sounds (${F1}) version 3 -> 4: image of artist Artist One changed`);
    expect(text).toContain('Draft Fest');
    expect(text).toContain('is draft, not bumped');
    expect(text).not.toContain('Nothing to do.');
  });

  it('does nothing for an entry whose object and row are already current', async () => {
    const tables = tablesWithSets();
    tables.artists[0] = artistRow(A1, 'Artist One', A1_COLUMNS);
    const { client, calls } = fakeClient(tables, { [`artists/${A1}.jpg`]: { md5: md5Of(JPEG) } });
    const result = await plan(client, [approvedArtist()]);
    expect(result.uploads).toEqual([]);
    expect(result.unchangedObjects).toBe(1);
    expect(result.rowUpdates).toEqual([]);
    expect(result.bumps).toEqual([]);
    expect(describeMediaPlan(result)).toContain('Nothing to do.');
    // The eTag matched, so no info() round trip and no sets query were needed.
    expect(calls.some((call) => call.startsWith('info:'))).toBe(false);
    expect(calls.some((call) => call.startsWith('select:sets'))).toBe(false);
  });

  it('falls back to the stored sha256 metadata and re-uploads when the checksum is unknown or differs', async () => {
    const tables = tablesWithSets();
    tables.artists[0] = artistRow(A1, 'Artist One', A1_COLUMNS);
    const sameSha = await plan(fakeClient(tables, { [`artists/${A1}.jpg`]: { md5: 'f'.repeat(32), sha256: sha256Of(JPEG) } }).client, [approvedArtist()]);
    expect(sameSha.uploads).toEqual([]);
    expect(sameSha.unchangedObjects).toBe(1);

    const changed = await plan(fakeClient(tables, { [`artists/${A1}.jpg`]: { md5: 'f'.repeat(32), sha256: 'e'.repeat(64) } }).client, [approvedArtist()]);
    expect(changed.uploads.map((upload) => upload.reason)).toEqual(['changed']);
    expect(changed.rowUpdates).toEqual([]);
    expect(changed.bumps).toEqual([]); // the URL did not change; clients see the new bytes at the same URL

    const unknown = await plan(fakeClient(tables, { [`artists/${A1}.jpg`]: { noInfo: true } }).client, [approvedArtist()]);
    expect(unknown.uploads.map((upload) => upload.reason)).toEqual(['checksum unknown']);
  });

  it('clears rows that point at our bucket without an approved entry, removes the object and bumps', async () => {
    const tables = tablesWithSets();
    tables.artists[0] = artistRow(A1, 'Artist One', A1_COLUMNS);
    tables.artists[1] = artistRow(A2, 'Artist Two', { image_url: 'https://example.org/own-cdn/two.jpg', image_license: 'press-kit-editorial' });
    const { client } = fakeClient(tables, { [`artists/${A1}.jpg`]: { md5: md5Of(JPEG) } });
    const pending = approvedArtist({ review: { status: 'pending', by: null, at: null } });
    const result = await plan(client, [pending]);

    expect(result.approved).toBe(0);
    expect(result.skipped).toEqual([{ index: 0, entry: pending, reason: 'pending (not approved)' }]);
    expect(result.uploads).toEqual([]);
    expect(result.clears).toEqual([{ table: 'artists', id: A1, name: 'Artist One', before: A1_COLUMNS, objectPath: `artists/${A1}.jpg` }]);
    expect(result.removals).toEqual([`artists/${A1}.jpg`]);
    expect(result.bumps).toEqual([{ festivalId: F1, name: 'Riverside Sounds', version: 3, reasons: ['image of artist Artist One changed'] }]);
    // Artist Two's image is not ours: left alone.
    expect(result.rowUpdates).toEqual([]);
    expect(describeMediaPlan(result)).toContain(`entries[0] Artist One: pending (not approved)`);
  });

  it('handles a festival\'s own image, orphan objects, missing rows and invalid approved entries', async () => {
    const tables = tablesWithSets();
    tables.artists = [artistRow(A1, 'Artist One')];
    const orphan = `artists/${A2}.jpg`;
    const { client } = fakeClient(tables, { [orphan]: { md5: 'a'.repeat(32) } });
    const invalid = approvedArtist({ subject_id: A2, subject_name: 'Artist Two', file: `artists/${A2}.jpg`, sha256: '0'.repeat(64) });
    const dir = mediaDir({ [`artists/${A1}.jpg`]: JPEG, [`artists/${A2}.jpg`]: JPEG, [`festivals/${F1}.png`]: PNG });
    const result = await plan(client, [approvedFestival(), approvedArtist({ subject_id: A2, subject_name: 'Artist Two', file: `artists/${A2}.jpg` }), invalid], dir);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('invalid: sha256: does not match the file');
    expect(result.missingRows).toEqual([{ table: 'artists', id: A2, name: 'Artist Two' }]);
    expect(result.uploads.map((upload) => upload.path)).toEqual([`festivals/${F1}.png`, orphan]);
    expect(result.rowUpdates).toEqual([
      {
        table: 'festivals',
        id: F1,
        name: 'Riverside Sounds',
        before: NO_IMAGE,
        after: { image_url: artworkPublicUrl(URL, `festivals/${F1}.png`), image_credit: 'Photo courtesy of Riverside Sounds', image_license: 'organizer-permission', image_source_url: null },
      },
    ]);
    expect(result.bumps).toEqual([{ festivalId: F1, name: 'Riverside Sounds', version: 3, reasons: ['image of Riverside Sounds changed'] }]);
    // The orphan object is referenced by the (valid) approved entry for A2, so it is not removed.
    expect(result.removals).toEqual([]);

    const strayOnly = await plan(fakeClient(tablesWithSets(), { 'artists/00000000-0000-4000-8000-000000000000.jpg': {} }).client, []);
    expect(strayOnly.removals).toEqual(['artists/00000000-0000-4000-8000-000000000000.jpg']);
    expect(strayOnly.bumps).toEqual([]);
    expect(describeMediaPlan(result)).toContain('WARNING 1 approved entry has no database row');
  });
});

describe('applyMediaUpload', () => {
  it('uploads, updates rows, clears, removes and bumps in that order', async () => {
    const tables = tablesWithSets();
    tables.festivals[2] = festivalRow(F3, 'Other Fest', 'published', 7, { image_url: artworkPublicUrl(URL, `festivals/${F3}.jpg`), image_license: 'generated' });
    const { client, calls } = fakeClient(tables, { [`festivals/${F3}.jpg`]: { md5: 'b'.repeat(32), sha256: 'c'.repeat(64) } });
    const planned = await plan(client, [approvedArtist()]);
    expect(planned.clears.map((clear) => clear.id)).toEqual([F3]);
    expect(planned.bumps.map((bump) => bump.name)).toEqual(['Other Fest', 'Riverside Sounds']);
    calls.length = 0;

    const lines: string[] = [];
    const result = await applyMediaUpload(client, planned, (line) => lines.push(line));
    expect(result).toEqual({
      uploaded: 1,
      updated: 1,
      cleared: 1,
      removed: 1,
      bumped: [
        { festivalId: F3, from: 7, to: 8 },
        { festivalId: F1, from: 3, to: 4 },
      ],
    });
    expect(calls).toEqual([
      `upload:artists/${A1}.jpg:image/jpeg:true:${sha256Of(JPEG).slice(0, 8)}:${JPEG.length}`,
      `update:artists:${A1}:${JSON.stringify(A1_COLUMNS)}`,
      `update:festivals:${F3}:${JSON.stringify(NO_IMAGE)}`,
      `remove:festivals/${F3}.jpg`,
      'select:festivals:1',
      expect.stringMatching(new RegExp(`^update:festivals:${F3}:\\{"version":8,"updated_at":"`)),
      'select:festivals:1',
      expect.stringMatching(new RegExp(`^update:festivals:${F1}:\\{"version":4,"updated_at":"`)),
    ]);
    expect(tables.artists[0]).toMatchObject(A1_COLUMNS);
    expect(tables.festivals[0]).toMatchObject({ version: 4 });
    expect(tables.festivals[2]).toMatchObject({ version: 8, image_url: null });
    expect(lines).toEqual([
      `Uploaded artists/${A1}.jpg (Artist One).`,
      'Updated 1 row(s).',
      'Cleared 1 row(s).',
      'Removed 1 object(s).',
      'Bumped Other Fest to version 8.',
      'Bumped Riverside Sounds to version 4.',
    ]);
  });

  it('stops at a failed upload before touching rows', async () => {
    const { client } = fakeClient(tablesWithSets());
    const planned = await plan(client, [approvedArtist()]);
    const failing = {
      ...client,
      storage: { from: () => ({ upload: async () => ({ data: null, error: { message: 'bucket missing' } }) }) },
    } as unknown as SupabaseClient;
    await expect(applyMediaUpload(failing, planned)).rejects.toThrow(`Uploading artwork/artists/${A1}.jpg failed after 0 upload(s): bucket missing`);
  });
});

describe('media:upload command', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  function registryOnDisk(entries: MediaEntry[]): { file: string; seedDataDir: string } {
    const dir = mediaDir();
    const file = path.join(dir, 'registry.json');
    writeRegistry({ version: 1, entries } as MediaRegistry, file);
    const seedDataDir = mkdtempSync(path.join(os.tmpdir(), 'festie-seed-data-'));
    dirs.push(seedDataDir);
    writeFileSync(
      path.join(seedDataDir, 'riverside.json'),
      JSON.stringify({ festival: { id: F1, name: 'Riverside Sounds' }, artists: [{ id: A1, name: 'Artist One' }, { id: A2, name: 'Artist Two' }] }),
    );
    return { file, seedDataDir };
  }

  it('validates only on a dry run without credentials and refuses an invalid registry', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    const lines: string[] = [];
    const { file, seedDataDir } = registryOnDisk([approvedArtist()]);
    const result = await mediaUpload({ dryRun: true, file, seedDataDir, log: (line) => lines.push(line) });
    expect(result.plan).toBeNull();
    expect(lines.at(-1)).toContain('Dry run: registry is valid.');
    await expect(mediaUpload({ dryRun: false, file, seedDataDir })).rejects.toThrow('Missing SUPABASE_URL');

    const bad = registryOnDisk([approvedArtist({ sha256: '0'.repeat(64) })]);
    await expect(mediaUpload({ dryRun: true, file: bad.file, seedDataDir: bad.seedDataDir })).rejects.toThrow('Fix the registry before uploading');
    await expect(MEDIA_COMMANDS['media:upload'](['--force'], () => {})).rejects.toThrow('Usage: media:upload [--dry-run]');
  });

  it('plans against an injected client and applies unless dry run', async () => {
    const { file, seedDataDir } = registryOnDisk([approvedArtist()]);
    const { client, calls } = fakeClient(tablesWithSets());
    const lines: string[] = [];
    const dry = await mediaUpload({ dryRun: true, file, seedDataDir, client, supabaseUrl: URL, log: (line) => lines.push(line) });
    expect(dry.plan?.uploads).toHaveLength(1);
    expect(dry.applied).toBeNull();
    expect(lines.at(-1)).toBe('Dry run: nothing written.');
    expect(calls.some((call) => call.startsWith('upload:'))).toBe(false);

    const real = await mediaUpload({ dryRun: false, file, seedDataDir, client, supabaseUrl: URL, log: (line) => lines.push(line) });
    expect(real.applied).toEqual({ uploaded: 1, updated: 1, cleared: 0, removed: 0, bumped: [{ festivalId: F1, from: 3, to: 4 }] });
    expect(lines.at(-1)).toBe('Done: 1 uploaded, 1 row(s) updated, 0 cleared, 0 object(s) removed, 1 festival version(s) bumped.');
    await expect(mediaUpload({ dryRun: true, file, seedDataDir, client })).rejects.toThrow('needs supabaseUrl');
  });
});
