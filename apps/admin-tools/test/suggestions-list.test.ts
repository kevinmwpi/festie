import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatSuggestionTable,
  listSuggestions,
  setSuggestionStatus,
  suggestionToCandidate,
  type SuggestionRow,
} from '../src/suggestions/list';

const S1 = '6f1d2c3b-0000-4000-8000-0000000000d1';
const S2 = '6f1d2c3b-0000-4000-8000-0000000000d2';
const S3 = '6f1d2c3b-0000-4000-8000-0000000000d3';
const U1 = '6f1d2c3b-0000-4000-8000-0000000000bb';
const U2 = '6f1d2c3b-0000-4000-8000-0000000000bc';

function rows(): SuggestionRow[] {
  return [
    { id: S1, user_id: U1, name: 'Rock en Seine', url: 'https://www.rockenseine.com/', note: 'Paris, late August', status: 'new', created_at: '2026-10-01T10:00:00Z' },
    { id: S2, user_id: U2, name: 'Primavera Sound', url: null, note: null, status: 'accepted', created_at: '2026-10-02T10:00:00Z' },
    { id: S3, user_id: null, name: '???', url: null, note: 'no name', status: 'rejected', created_at: '2026-10-03T10:00:00Z' },
  ];
}

/** PostgREST-ish fake: reads come from `data`, writes are recorded and applied to it. */
function fakeClient(data = rows(), users = [{ id: U1, display_name: 'Maya' }]) {
  const writes: string[] = [];
  const client = {
    from(table: string) {
      const filters: string[] = [];
      let op = 'select';
      let values: Record<string, unknown> = {};
      const idFilter = () => filters.find((f) => f.startsWith('id='))?.slice(3);
      const builder = {
        select: () => builder,
        order: () => builder,
        limit(n: number) {
          filters.push(`limit=${n}`);
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push(`${column}=${String(value)}`);
          return builder;
        },
        in(column: string, list: unknown[]) {
          filters.push(`${column} in ${list.join(',')}`);
          return builder;
        },
        update(next: Record<string, unknown>) {
          op = 'update';
          values = next;
          return builder;
        },
        async maybeSingle() {
          writes.push(`${table}:${op} ${filters.join(' ')}`);
          return { data: data.find((row) => row.id === idFilter()) ?? null, error: null };
        },
        then(resolve: (value: unknown) => void) {
          writes.push(`${table}:${op}${op === 'update' ? `:${JSON.stringify(values)}` : ''} ${filters.join(' ')}`);
          if (op === 'update') {
            const row = data.find((r) => r.id === idFilter());
            if (row) {
              Object.assign(row, values);
            }
            resolve({ data: null, error: null });
            return;
          }
          if (table === 'users') {
            resolve({ data: users, error: null });
            return;
          }
          const status = filters.find((f) => f.startsWith('status='))?.slice(7);
          resolve({ data: status ? data.filter((row) => row.status === status) : data, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, writes, data };
}

describe('listSuggestions', () => {
  it('filters by status and joins the display name', async () => {
    const { client, writes } = fakeClient();
    const list = await listSuggestions(client, { status: 'new', limit: 20 });
    expect(list).toEqual([{ ...rows()[0], user_name: 'Maya' }]);
    expect(writes).toEqual([`festival_suggestions:select limit=20 status=new`, `users:select id in ${U1}`]);
  });

  it('returns every status with "all" and null names for unknown or deleted users', async () => {
    const { client, writes } = fakeClient();
    const list = await listSuggestions(client, { status: 'all', limit: 5 });
    expect(list.map((row) => [row.id, row.user_name])).toEqual([
      [S1, 'Maya'],
      [S2, null],
      [S3, null],
    ]);
    expect(writes[0]).toBe('festival_suggestions:select limit=5');
    expect(writes[1]).toBe(`users:select id in ${U1},${U2}`);
  });

  it('formats a table', async () => {
    const { client } = fakeClient();
    const text = formatSuggestionTable(await listSuggestions(client, { status: 'all', limit: 5 }));
    expect(text).toContain(`${S1}  2026-10-01 10:00  NEW  Rock en Seine`);
    expect(text).toContain('url   https://www.rockenseine.com/');
    expect(text).toContain('note  Paris, late August');
    expect(text).toContain('from  Maya');
    expect(text).toContain(`from  ${U2}`);
    expect(text).toContain('from  deleted account');
    expect(formatSuggestionTable([])).toBe('No suggestions.');
  });
});

describe('setSuggestionStatus', () => {
  it('validates input and writes the status', async () => {
    const { client, writes } = fakeClient();
    await expect(setSuggestionStatus(client, S1, 'maybe' as never)).rejects.toThrow(/must be one of new, accepted, rejected, duplicate/);
    await expect(setSuggestionStatus(client, 'nope', 'rejected')).rejects.toThrow(/not a suggestion id/);
    await expect(setSuggestionStatus(client, '6f1d2c3b-0000-4000-8000-0000000000ff', 'rejected')).rejects.toThrow(/not found/);
    expect(writes.filter((w) => w.includes('update'))).toEqual([]);

    const updated = await setSuggestionStatus(client, S1, 'duplicate');
    expect(updated).toMatchObject({ id: S1, status: 'duplicate' });
    expect(writes.at(-1)).toBe(`festival_suggestions:update:{"status":"duplicate"} id=${S1}`);
  });
});

describe('suggestionToCandidate', () => {
  let tmp = '';
  let root = '';

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'festie-suggestions-'));
    root = path.join(tmp, 'seed-data');
    mkdirSync(root);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('scaffolds a candidate from the suggestion and marks it accepted', async () => {
    const { client, writes, data } = fakeClient();
    const result = await suggestionToCandidate(client, { id: S1, root });
    expect(result.dir).toBe(path.join(root, 'candidates', 'rock-en-seine'));
    expect(result.suggestion.status).toBe('accepted');
    expect(data[0].status).toBe('accepted');
    expect(writes.at(-1)).toBe(`festival_suggestions:update:{"status":"accepted"} id=${S1}`);

    const file = JSON.parse(readFileSync(path.join(result.dir, 'candidate.json'), 'utf8'));
    expect(file).toMatchObject({
      slug: 'rock-en-seine',
      name: 'Rock en Seine',
      status: 'needs_review',
      trigger: { kind: 'suggestion', suggestion_id: S1, note: 'Paris, late August' },
      agent: { tool: 'manual' },
    });
    expect(file.sources).toEqual([
      expect.objectContaining({ url: 'https://www.rockenseine.com/', kind: 'other', title: null, used_for: [] }),
    ]);
    expect(existsSync(path.join(result.dir, 'sets.csv'))).toBe(true);
    expect(readFileSync(path.join(result.dir, 'REVIEW.md'), 'utf8')).toContain(`suggestion ${S1}`);
  });

  it('takes an explicit slug and no source without a URL', async () => {
    const { client } = fakeClient();
    const result = await suggestionToCandidate(client, { id: S2, slug: 'primavera-sound-2027', root });
    expect(result.dir).toBe(path.join(root, 'candidates', 'primavera-sound-2027'));
    expect(result.file.sources).toEqual([]);
  });

  it('uses the golden slug when a festival of that name is already golden, unless a slug is given', async () => {
    mkdirSync(path.join(root, 'golden'));
    writeFileSync(
      path.join(root, 'golden', 'index.json'),
      JSON.stringify({
        version: 1,
        festivals: [
          { slug: 'other-fest', festival_id: '6f1d2c3b-0000-4000-8000-0000000000f0', name: 'Other Fest', seed_file: 'seed-data/other-fest.json', csv_dir: null, candidate: null, promoted_at: '2026-01-01T00:00:00Z', verified: null },
          { slug: 'rock-en-seine-2026', festival_id: '6f1d2c3b-0000-4000-8000-0000000000f1', name: 'ROCK  en Seine', seed_file: 'seed-data/rock-en-seine-2026.json', csv_dir: null, candidate: null, promoted_at: '2026-01-01T00:00:00Z', verified: null },
        ],
      }),
    );
    const { client, data } = fakeClient();
    const result = await suggestionToCandidate(client, { id: S1, root });
    expect(result.dir).toBe(path.join(root, 'candidates', 'rock-en-seine-2026'));
    expect(result.file.slug).toBe('rock-en-seine-2026');
    expect(result.file.name).toBe('Rock en Seine');
    expect(data[0].status).toBe('accepted');

    // A name that is not golden still gets the slugified name; an explicit slug always wins.
    expect((await suggestionToCandidate(client, { id: S2, root })).dir).toBe(path.join(root, 'candidates', 'primavera-sound'));
    data[0].status = 'new';
    const explicit = await suggestionToCandidate(client, { id: S1, slug: 'rock-en-seine-changes-2026-10-12', root });
    expect(explicit.dir).toBe(path.join(root, 'candidates', 'rock-en-seine-changes-2026-10-12'));
  });

  it('refuses rejected suggestions, bad slugs and existing directories without touching the status', async () => {
    const { client, writes, data } = fakeClient();
    await expect(suggestionToCandidate(client, { id: S3, root })).rejects.toThrow(/is rejected/);
    data[2].status = 'new';
    await expect(suggestionToCandidate(client, { id: S3, root })).rejects.toThrow(/pass --slug/);
    await expect(suggestionToCandidate(client, { id: S1, slug: 'Bad Slug', root })).rejects.toThrow(/not a slug/);
    mkdirSync(path.join(root, 'candidates', 'rock-en-seine'), { recursive: true });
    await expect(suggestionToCandidate(client, { id: S1, root })).rejects.toThrow(/already exists/);
    expect(writes.some((w) => w.includes('update'))).toBe(false);
    expect(data[0].status).toBe('new');
  });
});
