import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  candidatesRoot,
  deriveCandidateStatus,
  evaluateCandidate,
  formatCandidateTable,
  formatEvalReport,
  listCandidates,
  loadCandidate,
  promoteCandidate,
  readGoldenIndex,
  saveCandidateMediaReview,
  saveCandidateReview,
} from '../src/candidates/store';
import type { CandidateFile } from '../src/candidates/types';
import { buildSeedFromCsv, CSV_FILES, type CsvInput } from '../src/festival/import-csv';
import type { FestivalSeed } from '../src/festival/types';
import { validateFestivalSeed } from '../src/festival/validate';
import type { MediaEntry, MediaRegistry } from '../src/media/types';
import { readRepoFile } from './fixtures';

/** 1×1 transparent PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG_SHA = createHash('sha256').update(PNG).digest('hex');

let tmp = '';
let root = '';

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'festie-candidates-'));
  root = path.join(tmp, 'seed-data');
  mkdirSync(root);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** The demo festival CSVs with the festival set back to draft, as a candidate would be. */
function demoCsv(): CsvInput {
  return {
    'festival.csv': readRepoFile('seed-data/demo-festival-csv/festival.csv').replace(',published,', ',draft,'),
    'stages.csv': readRepoFile('seed-data/demo-festival-csv/stages.csv'),
    'artists.csv': readRepoFile('seed-data/demo-festival-csv/artists.csv'),
    'sets.csv': readRepoFile('seed-data/demo-festival-csv/sets.csv'),
  };
}

function seedOf(csv: CsvInput): FestivalSeed {
  const result = validateFestivalSeed(buildSeedFromCsv(csv).seed);
  if (!result.seed) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.seed;
}

const ALL = <T>(value: T) => ({ festival: value, stages: value, artists: value, sets: value });

function candidateJson(slug: string, overrides: Partial<CandidateFile> = {}): CandidateFile {
  return {
    version: 1,
    slug,
    name: 'Festie Demo Fest',
    created_at: '2026-10-12T10:00:00.000Z',
    status: 'needs_review',
    trigger: { kind: 'manual', suggestion_id: null, note: null },
    agent: { tool: 'test', run_id: null, started_at: '2026-10-12T09:00:00.000Z', finished_at: null },
    sources: [],
    confidence: ALL('medium' as const),
    notes: '',
    review: { decisions: ALL('pending' as const), by: null, at: null, notes: null },
    promoted: null,
    ...overrides,
  };
}

const APPROVED: Partial<CandidateFile> = {
  status: 'approved',
  review: { decisions: ALL('approved' as const), by: 'kevin', at: '2026-10-12T11:00:00.000Z', notes: null },
};

function writeCandidate(slug: string, csv: Partial<CsvInput>, file: Partial<CandidateFile> | string = {}): string {
  const dir = path.join(root, 'candidates', slug);
  mkdirSync(dir, { recursive: true });
  for (const name of CSV_FILES) {
    const text = csv[name];
    if (text !== undefined) {
      writeFileSync(path.join(dir, name), text, 'utf8');
    }
  }
  const json = typeof file === 'string' ? file : JSON.stringify(candidateJson(slug, file), null, 2);
  writeFileSync(path.join(dir, 'candidate.json'), json, 'utf8');
  return dir;
}

function mediaEntry(seed: FestivalSeed, overrides: Partial<MediaEntry> = {}): MediaEntry {
  const artist = seed.artists[0];
  return {
    subject_type: 'artist',
    subject_id: artist.id,
    subject_name: artist.name,
    file: `artists/${artist.id}.png`,
    sha256: PNG_SHA,
    mime: 'image/png',
    width: 1,
    height: 1,
    source: { kind: 'wikimedia-commons', url: 'https://commons.wikimedia.org/wiki/File:x.png', retrieved_at: '2026-10-12T09:30:00Z' },
    license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: null },
    review: { status: 'approved', by: 'kevin', at: '2026-10-12T11:00:00Z' },
    ...overrides,
  };
}

function writeMedia(dir: string, entries: MediaEntry[], withFiles = true): void {
  const registry: MediaRegistry = { version: 1, entries };
  mkdirSync(path.join(dir, 'media'), { recursive: true });
  writeFileSync(path.join(dir, 'media', 'registry.json'), JSON.stringify(registry, null, 2));
  if (withFiles) {
    for (const entry of entries) {
      mkdirSync(path.dirname(path.join(dir, 'media', entry.file)), { recursive: true });
      writeFileSync(path.join(dir, 'media', entry.file), PNG);
    }
  }
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

describe('candidatesRoot', () => {
  it('defaults to the repo seed-data directory and accepts another root', () => {
    expect(candidatesRoot().split(path.sep).slice(-2)).toEqual(['seed-data', 'candidates']);
    expect(candidatesRoot(root)).toBe(path.join(root, 'candidates'));
  });
});

describe('listCandidates', () => {
  it('returns nothing without a candidates directory', async () => {
    expect(await listCandidates(root)).toEqual([]);
  });

  it('lists directories with a candidate.json, skipping _scratch dirs, plain files and dirs without one', async () => {
    writeCandidate('demo-festival', demoCsv());
    writeCandidate('_scratch', demoCsv());
    mkdirSync(path.join(root, 'candidates', 'no-json'));
    writeFileSync(path.join(root, 'candidates', 'README.md'), '# readme');
    const seed = seedOf(demoCsv());

    const list = await listCandidates(root);
    expect(list.map((c) => c.slug)).toEqual(['demo-festival']);
    expect(list[0]).toMatchObject({
      name: 'Festie Demo Fest',
      status: 'needs_review',
      created_at: '2026-10-12T10:00:00.000Z',
      counts: { stages: seed.stages.length, artists: seed.artists.length, sets: seed.sets.length },
      media: { pending: 0, approved: 0, rejected: 0 },
      errors: 0,
      warnings: 0,
    });
  });

  it('tolerates a broken candidate.json', async () => {
    writeCandidate('broken', demoCsv(), '{ not json');
    const [summary] = await listCandidates(root);
    expect(summary).toMatchObject({ slug: 'broken', name: 'broken', status: 'needs_review', errors: 1 });
    expect(summary.created_at).toMatch(/^\d{4}-/);
  });

  it('counts media by review status and rows of broken bundles', async () => {
    const seed = seedOf(demoCsv());
    const csv = demoCsv();
    delete (csv as Partial<CsvInput>)['sets.csv'];
    const dir = writeCandidate('partial', csv);
    writeMedia(dir, [
      mediaEntry(seed),
      mediaEntry(seed, { review: { status: 'pending', by: null, at: null } }),
      mediaEntry(seed, { review: { status: 'rejected', by: 'kevin', at: '2026-10-12T11:00:00Z' } }),
    ]);
    const [summary] = await listCandidates(root);
    expect(summary.media).toEqual({ pending: 1, approved: 1, rejected: 1 });
    expect(summary.errors).toBe(1);
    expect(summary.counts).toEqual({ stages: seed.stages.length, artists: seed.artists.length, sets: 0 });
  });

  it('sorts newest first', async () => {
    writeCandidate('older', demoCsv(), { created_at: '2026-10-01T00:00:00Z' });
    writeCandidate('newer', demoCsv(), { created_at: '2026-10-11T00:00:00Z' });
    expect((await listCandidates(root)).map((c) => c.slug)).toEqual(['newer', 'older']);
  });

  it('formats a table', async () => {
    writeCandidate('demo-festival', demoCsv());
    const text = formatCandidateTable(await listCandidates(root));
    expect(text.split('\n')[0]).toContain('SLUG');
    expect(text).toContain('demo-festival');
    expect(text).toContain('Festie Demo Fest');
    expect(formatCandidateTable([])).toBe('No candidates.');
  });
});

describe('loadCandidate', () => {
  it('loads the file, CSVs, validated seed, media and REVIEW.md', async () => {
    const dir = writeCandidate('demo-festival', demoCsv(), { slug: 'something-else' });
    writeFileSync(path.join(dir, 'REVIEW.md'), '# review');
    writeMedia(dir, [mediaEntry(seedOf(demoCsv()))]);

    const loaded = await loadCandidate('demo-festival', root);
    expect(loaded.dir).toBe(dir);
    expect(loaded.file.slug).toBe('demo-festival');
    expect(loaded.file.review.decisions).toEqual(ALL('pending'));
    expect(loaded.csv['sets.csv']).toBe(demoCsv()['sets.csv']);
    expect(loaded.seed).toEqual(seedOf(demoCsv()));
    expect(loaded.seed?.festival.status).toBe('draft');
    expect(loaded.errors).toEqual([]);
    expect(loaded.media?.entries).toHaveLength(1);
    expect(loaded.reviewMarkdown).toBe('# review');
  });

  it('fills defaults for an incomplete candidate.json', async () => {
    writeCandidate('sparse', demoCsv(), JSON.stringify({ name: 'Sparse', status: 'bogus', extra: 1 }));
    const loaded = await loadCandidate('sparse', root);
    expect(loaded.file).toMatchObject({
      slug: 'sparse',
      name: 'Sparse',
      status: 'needs_review',
      confidence: ALL('low'),
      review: { decisions: ALL('pending'), by: null, at: null },
      sources: [],
      promoted: null,
    });
    expect((loaded.file as unknown as Record<string, unknown>).extra).toBe(1);
  });

  it('reports missing CSV files as errors', async () => {
    const csv = demoCsv();
    delete (csv as Partial<CsvInput>)['sets.csv'];
    writeCandidate('partial', csv);
    const loaded = await loadCandidate('partial', root);
    expect(loaded.seed).toBeNull();
    expect(loaded.errors.map((issue) => issue.path)).toEqual(['sets.csv: missing']);
    expect(loaded.csv['sets.csv']).toBe('');
  });

  it('reports CSV problems through the importer and validator', async () => {
    const csv = demoCsv();
    csv['sets.csv'] += 'Nobody,Great Lawn Stage,2027-06-20 10:00,2027-06-20 11:00\n';
    writeCandidate('bad-set', csv);
    const loaded = await loadCandidate('bad-set', root);
    expect(loaded.seed).toBeNull();
    expect(loaded.errors[0].message).toContain('"Nobody" is not listed in artists.csv');
  });

  it('throws for unknown or invalid slugs and broken JSON', async () => {
    await expect(loadCandidate('nope', root)).rejects.toThrow(/not found/);
    await expect(loadCandidate('../etc', root)).rejects.toThrow(/not a slug/);
    writeCandidate('broken', demoCsv(), '{');
    await expect(loadCandidate('broken', root)).rejects.toThrow(/not valid JSON/);
  });
});

describe('saveCandidateReview', () => {
  it('derives the status from the decisions', () => {
    expect(deriveCandidateStatus(ALL('pending'))).toBe('needs_review');
    expect(deriveCandidateStatus({ ...ALL('approved'), sets: 'pending' })).toBe('needs_review');
    expect(deriveCandidateStatus(ALL('approved'))).toBe('approved');
    expect(deriveCandidateStatus({ ...ALL('approved'), artists: 'rejected' })).toBe('rejected');
    expect(deriveCandidateStatus({ ...ALL('pending'), artists: 'rejected' })).toBe('rejected');
  });

  it('writes the review back, defaulting `at` to now', async () => {
    const dir = writeCandidate('demo-festival', demoCsv());
    const before = Date.now();
    const saved = await saveCandidateReview('demo-festival', { decisions: ALL('approved'), by: 'kevin', at: null, notes: 'ok' }, root);
    expect(saved.status).toBe('approved');
    expect(saved.review.by).toBe('kevin');
    expect(saved.review.notes).toBe('ok');
    expect(Date.parse(saved.review.at!)).toBeGreaterThanOrEqual(before - 1000);
    const onDisk = readJson(path.join(dir, 'candidate.json'));
    expect(onDisk.status).toBe('approved');
    expect(onDisk.review).toEqual(saved.review);
    expect(readFileSync(path.join(dir, 'candidate.json'), 'utf8').endsWith('}\n')).toBe(true);

    const rejected = await saveCandidateReview(
      'demo-festival',
      { decisions: { ...ALL('approved'), sets: 'rejected' }, by: 'kevin', at: '2026-10-12T12:00:00Z' },
      root,
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.review.at).toBe('2026-10-12T12:00:00Z');
    const pending = await saveCandidateReview('demo-festival', { decisions: ALL('pending'), by: null, at: null }, root);
    expect(pending.status).toBe('needs_review');
  });

  it('requires a reviewer name to approve any section', async () => {
    const dir = writeCandidate('demo-festival', demoCsv());
    for (const by of [null, '', '   ']) {
      await expect(saveCandidateReview('demo-festival', { decisions: ALL('approved'), by, at: null }, root)).rejects.toThrow(
        'Approving a section records who approved it; enter a reviewer name',
      );
      await expect(
        saveCandidateReview('demo-festival', { decisions: { ...ALL('pending'), stages: 'approved' }, by, at: null }, root),
      ).rejects.toThrow(/enter a reviewer name/);
    }
    expect(readJson(path.join(dir, 'candidate.json')).status).toBe('needs_review');
    const rejected = await saveCandidateReview('demo-festival', { decisions: { ...ALL('pending'), sets: 'rejected' }, by: null, at: null }, root);
    expect(rejected.status).toBe('rejected');
  });

  it('rejects malformed decisions and never downgrades a promoted candidate', async () => {
    writeCandidate('demo-festival', demoCsv());
    await expect(
      saveCandidateReview('demo-festival', { decisions: { ...ALL('approved'), media: 'approved' } as never, by: null, at: null }, root),
    ).rejects.toThrow(/unknown section "media"/);
    await expect(
      saveCandidateReview('demo-festival', { decisions: { ...ALL('approved'), sets: 'yes' } as never, by: null, at: null }, root),
    ).rejects.toThrow(/decisions.sets must be one of/);
    await expect(
      saveCandidateReview('demo-festival', { decisions: { festival: 'approved' } as never, by: null, at: null }, root),
    ).rejects.toThrow(/decisions.stages/);

    writeCandidate('done', demoCsv(), {
      ...APPROVED,
      status: 'promoted',
      promoted: { at: '2026-10-12T12:00:00Z', seed_file: 'seed-data/done.json', csv_dir: 'seed-data/done-csv' },
    });
    await expect(saveCandidateReview('done', { decisions: ALL('pending'), by: null, at: null }, root)).rejects.toThrow(/promoted/);
    expect(readJson(path.join(root, 'candidates', 'done', 'candidate.json')).status).toBe('promoted');
  });
});

describe('saveCandidateMediaReview', () => {
  it('updates one entry in media/registry.json', async () => {
    const seed = seedOf(demoCsv());
    const dir = writeCandidate('demo-festival', demoCsv());
    writeMedia(dir, [mediaEntry(seed, { review: { status: 'pending', by: null, at: null } }), mediaEntry(seed)]);
    const entry = await saveCandidateMediaReview('demo-festival', 0, { status: 'approved', by: 'kevin', at: null, note: 'fine' }, root);
    expect(entry.review).toMatchObject({ status: 'approved', by: 'kevin', note: 'fine' });
    expect(entry.review.at).toMatch(/^\d{4}-/);
    const onDisk = readJson(path.join(dir, 'media', 'registry.json'));
    expect(onDisk.entries[0].review).toEqual(entry.review);
    expect(onDisk.entries[1].review.status).toBe('approved');
    await expect(saveCandidateMediaReview('demo-festival', 2, { status: 'rejected', by: null, at: null }, root)).rejects.toThrow(/does not exist/);
    await expect(saveCandidateMediaReview('demo-festival', 0, { status: 'maybe' as never, by: null, at: null }, root)).rejects.toThrow(/must be one of/);
  });

  it('requires a reviewer name to approve an image', async () => {
    const seed = seedOf(demoCsv());
    const dir = writeCandidate('demo-festival', demoCsv());
    writeMedia(dir, [mediaEntry(seed, { review: { status: 'pending', by: null, at: null } })]);
    for (const by of [null, '', '  ']) {
      await expect(saveCandidateMediaReview('demo-festival', 0, { status: 'approved', by, at: null }, root)).rejects.toThrow(
        'Approving an image records who approved it; enter a reviewer name',
      );
    }
    expect(readJson(path.join(dir, 'media', 'registry.json')).entries[0].review.status).toBe('pending');
    const rejected = await saveCandidateMediaReview('demo-festival', 0, { status: 'rejected', by: null, at: null }, root);
    expect(rejected.review.status).toBe('rejected');
  });

  it('throws when the candidate has no registry', async () => {
    writeCandidate('demo-festival', demoCsv());
    await expect(saveCandidateMediaReview('demo-festival', 0, { status: 'approved', by: null, at: null }, root)).rejects.toThrow(/no media/);
  });
});

describe('promoteCandidate', () => {
  it('refuses candidates that are not fully approved', async () => {
    writeCandidate('demo-festival', demoCsv());
    await expect(promoteCandidate('demo-festival', { dryRun: true, root })).rejects.toThrow(/needs_review.*not approved: festival=pending/);
    writeCandidate('partly', demoCsv(), {
      status: 'approved',
      review: { decisions: { ...ALL('approved'), sets: 'pending' }, by: 'kevin', at: '2026-10-12T11:00:00Z' },
    });
    await expect(promoteCandidate('partly', { dryRun: true, root })).rejects.toThrow(/sets=pending/);
    writeCandidate('rejected', demoCsv(), {
      status: 'rejected',
      review: { decisions: { ...ALL('approved'), artists: 'rejected' }, by: 'kevin', at: '2026-10-12T11:00:00Z' },
    });
    await expect(promoteCandidate('rejected', { dryRun: true, root })).rejects.toThrow(/rejected/);
    expect(existsSync(path.join(root, 'demo-festival.json'))).toBe(false);
  });

  it('refuses a bundle that does not validate', async () => {
    const csv = demoCsv();
    csv['sets.csv'] += 'Nobody,Great Lawn Stage,2027-06-20 10:00,2027-06-20 11:00\n';
    writeCandidate('demo-festival', csv, APPROVED);
    await expect(promoteCandidate('demo-festival', { dryRun: false, root })).rejects.toThrow(/does not build a valid festival[\s\S]*Nobody/);
    expect(existsSync(path.join(root, 'demo-festival.json'))).toBe(false);
  });

  it('dry run lists the actions and writes nothing', async () => {
    const dir = writeCandidate('demo-festival', demoCsv(), APPROVED);
    const result = await promoteCandidate('demo-festival', { dryRun: true, root });
    expect(result.slug).toBe('demo-festival');
    expect(result.seedFile).toBe(path.join(root, 'demo-festival.json'));
    expect(result.csvDir).toBe(path.join(root, 'demo-festival-csv'));
    expect(result.mediaMerged).toBe(0);
    expect(result.actions).toEqual([
      'write seed-data/demo-festival-csv/festival.csv',
      'write seed-data/demo-festival-csv/stages.csv',
      'write seed-data/demo-festival-csv/artists.csv',
      'write seed-data/demo-festival-csv/sets.csv',
      expect.stringMatching(/^write seed-data\/demo-festival\.json \(Festie Demo Fest, draft: 4 stages, \d+ artists, 36 sets\)$/),
      'add demo-festival in seed-data/golden/index.json',
      'mark candidates/demo-festival/candidate.json promoted',
    ]);
    expect(existsSync(path.join(root, 'demo-festival.json'))).toBe(false);
    expect(existsSync(path.join(root, 'demo-festival-csv'))).toBe(false);
    expect(existsSync(path.join(root, 'golden', 'index.json'))).toBe(false);
    expect(readJson(path.join(dir, 'candidate.json')).status).toBe('approved');
  });

  it('writes the CSV dir, the seed, merges approved media, updates the golden index and marks the candidate', async () => {
    const seed = seedOf(demoCsv());
    const dir = writeCandidate('demo-festival', demoCsv(), APPROVED);
    const other = seed.artists[1];
    writeMedia(dir, [
      mediaEntry(seed),
      mediaEntry(seed, { subject_id: other.id, subject_name: other.name, file: `artists/${other.id}.png`, review: { status: 'pending', by: null, at: null } }),
      mediaEntry(seed, { subject_type: 'festival', subject_id: seed.festival.id, subject_name: seed.festival.name, file: `festivals/${seed.festival.id}.png` }),
    ]);
    // An older image for the same artist, and one for an unrelated subject, already in the shared registry.
    const oldEntry = mediaEntry(seed, { file: `artists/${seed.artists[0].id}-old.jpg`, sha256: 'old', mime: 'image/jpeg' });
    const unrelated = mediaEntry(seed, { subject_id: '99999999-9999-4999-8999-999999999999', subject_name: 'Someone', file: 'artists/someone.jpg' });
    mkdirSync(path.join(root, 'media'), { recursive: true });
    writeFileSync(path.join(root, 'media', 'registry.json'), JSON.stringify({ version: 1, entries: [oldEntry, unrelated] }));

    const before = Date.now();
    const result = await promoteCandidate('demo-festival', { dryRun: false, root });
    expect(result.mediaMerged).toBe(2);
    expect(result.actions).toContain(`copy media/artists/${seed.artists[0].id}.png to seed-data/media/artists/${seed.artists[0].id}.png (replaces ${oldEntry.file} for ${seed.artists[0].name})`);
    expect(result.actions).toContain('update seed-data/media/registry.json (+2 approved entries)');

    for (const name of CSV_FILES) {
      expect(readFileSync(path.join(root, 'demo-festival-csv', name), 'utf8')).toBe(demoCsv()[name]);
    }
    expect(readFileSync(path.join(root, 'demo-festival.json'), 'utf8')).toBe(`${JSON.stringify(seed, null, 2)}\n`);

    expect(readFileSync(path.join(root, 'media', 'artists', `${seed.artists[0].id}.png`))).toEqual(PNG);
    expect(readFileSync(path.join(root, 'media', 'festivals', `${seed.festival.id}.png`))).toEqual(PNG);
    expect(existsSync(path.join(root, 'media', 'artists', `${other.id}.png`))).toBe(false);
    const registry = readJson(path.join(root, 'media', 'registry.json'));
    expect(registry.version).toBe(1);
    expect(registry.entries.map((e: MediaEntry) => e.file)).toEqual(['artists/someone.jpg', `artists/${seed.artists[0].id}.png`, `festivals/${seed.festival.id}.png`]);

    const golden = readGoldenIndex(root);
    expect(golden.festivals).toHaveLength(1);
    expect(golden.festivals[0]).toMatchObject({
      slug: 'demo-festival',
      festival_id: seed.festival.id,
      name: 'Festie Demo Fest',
      seed_file: 'seed-data/demo-festival.json',
      csv_dir: 'seed-data/demo-festival-csv',
      candidate: 'demo-festival',
      verified: null,
    });
    expect(Date.parse(golden.festivals[0].promoted_at)).toBeGreaterThanOrEqual(before - 1000);

    const file = readJson(path.join(dir, 'candidate.json'));
    expect(file.status).toBe('promoted');
    expect(file.promoted).toMatchObject({ seed_file: 'seed-data/demo-festival.json', csv_dir: 'seed-data/demo-festival-csv' });
    expect(file.promoted.at).toBe(golden.festivals[0].promoted_at);

    await expect(promoteCandidate('demo-festival', { dryRun: false, root })).rejects.toThrow(/already promoted/);
  });

  it('replaces the files and golden entry of the same festival, keeping the golden notes', async () => {
    const seed = seedOf(demoCsv());
    writeFileSync(path.join(root, 'demo-festival.json'), JSON.stringify({ festival: { id: seed.festival.id } }));
    mkdirSync(path.join(root, 'demo-festival-csv'));
    mkdirSync(path.join(root, 'golden'));
    writeFileSync(
      path.join(root, 'golden', 'index.json'),
      JSON.stringify({
        version: 1,
        festivals: [
          { slug: 'demo-festival', festival_id: seed.festival.id, name: 'Old', seed_file: 'seed-data/demo-festival.json', csv_dir: null, candidate: null, promoted_at: '2026-01-01T00:00:00Z', verified: null, notes: 'fictional' },
          { slug: 'other', festival_id: '11111111-1111-4111-8111-111111111111', name: 'Other', seed_file: 'seed-data/other.json', csv_dir: null, candidate: null, promoted_at: '2026-01-01T00:00:00Z', verified: null },
        ],
      }),
    );
    writeCandidate('demo-festival', demoCsv(), APPROVED);

    const result = await promoteCandidate('demo-festival', { dryRun: false, root });
    expect(result.actions[0]).toBe('replace seed-data/demo-festival-csv/festival.csv');
    expect(result.actions).toContain(`replace demo-festival (festival ${seed.festival.id}) in seed-data/golden/index.json`);
    expect(readJson(path.join(root, 'demo-festival.json'))).toEqual(seed);
    const golden = readGoldenIndex(root);
    expect(golden.festivals.map((f) => f.slug)).toEqual(['other', 'demo-festival']);
    expect(golden.festivals[1]).toMatchObject({ name: 'Festie Demo Fest', candidate: 'demo-festival', csv_dir: 'seed-data/demo-festival-csv', notes: 'fictional' });
  });

  it('promotes a change candidate under another slug onto the golden files of the same festival', async () => {
    const seed = seedOf(demoCsv());
    writeFileSync(path.join(root, 'demo-festival.json'), JSON.stringify({ festival: { id: seed.festival.id } }));
    mkdirSync(path.join(root, 'demo-festival-csv'));
    writeFileSync(path.join(root, 'demo-festival-csv', 'sets.csv'), 'stale');
    mkdirSync(path.join(root, 'golden'));
    writeFileSync(
      path.join(root, 'golden', 'index.json'),
      JSON.stringify({
        version: 1,
        festivals: [
          {
            slug: 'demo-festival',
            festival_id: seed.festival.id,
            name: 'Festie Demo Fest',
            seed_file: 'seed-data/demo-festival.json',
            csv_dir: 'seed-data/demo-festival-csv',
            candidate: 'demo-festival',
            promoted_at: '2026-01-01T00:00:00Z',
            verified: { at: '2026-02-01T00:00:00Z', by: 'kevin', source_url: 'https://example.org/schedule' },
            notes: 'fictional',
          },
        ],
      }),
    );
    const dir = writeCandidate('demo-festival-2027', demoCsv(), APPROVED);

    const dry = await promoteCandidate('demo-festival-2027', { dryRun: true, root });
    expect(dry.seedFile).toBe(path.join(root, 'demo-festival.json'));
    expect(dry.csvDir).toBe(path.join(root, 'demo-festival-csv'));
    expect(dry.actions).toContain('replace seed-data/demo-festival-csv/sets.csv');
    expect(dry.actions).toContain(`replace demo-festival (festival ${seed.festival.id}) in seed-data/golden/index.json`);
    expect(dry.actions).toContain('mark candidates/demo-festival-2027/candidate.json promoted');
    expect(dry.actions.some((action) => action.includes('demo-festival-2027.json') || action.includes('demo-festival-2027-csv'))).toBe(false);
    expect(readFileSync(path.join(root, 'demo-festival-csv', 'sets.csv'), 'utf8')).toBe('stale');

    const result = await promoteCandidate('demo-festival-2027', { dryRun: false, root });
    expect(result.slug).toBe('demo-festival-2027');
    expect(result.seedFile).toBe(path.join(root, 'demo-festival.json'));
    // One seed file for the festival id: the golden one, overwritten; nothing under the candidate's slug.
    expect(readdirSync(root).filter((name) => name.endsWith('.json'))).toEqual(['demo-festival.json']);
    expect(readJson(path.join(root, 'demo-festival.json'))).toEqual(seed);
    expect(readFileSync(path.join(root, 'demo-festival-csv', 'sets.csv'), 'utf8')).toBe(demoCsv()['sets.csv']);
    expect(existsSync(path.join(root, 'demo-festival-2027-csv'))).toBe(false);

    const golden = readGoldenIndex(root);
    expect(golden.festivals).toHaveLength(1);
    expect(golden.festivals[0]).toMatchObject({
      slug: 'demo-festival',
      festival_id: seed.festival.id,
      name: 'Festie Demo Fest',
      seed_file: 'seed-data/demo-festival.json',
      csv_dir: 'seed-data/demo-festival-csv',
      candidate: 'demo-festival-2027',
      verified: null,
      notes: 'fictional',
    });
    const file = readJson(path.join(dir, 'candidate.json'));
    expect(file.status).toBe('promoted');
    expect(file.promoted).toMatchObject({ seed_file: 'seed-data/demo-festival.json', csv_dir: 'seed-data/demo-festival-csv' });
  });

  it("refuses to overwrite another festival's seed file or golden row", async () => {
    writeFileSync(path.join(root, 'demo-festival.json'), JSON.stringify({ festival: { id: '11111111-1111-4111-8111-111111111111' } }));
    const dir = writeCandidate('demo-festival', demoCsv(), APPROVED);
    await expect(promoteCandidate('demo-festival', { dryRun: false, root })).rejects.toThrow(/already exists with festival id 11111111/);
    expect(readJson(path.join(root, 'demo-festival.json')).festival.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(readJson(path.join(dir, 'candidate.json')).status).toBe('approved');
    expect(existsSync(path.join(root, 'golden', 'index.json'))).toBe(false);

    // The same clash through the golden index alone (the seed file is gone, the row is not).
    rmSync(path.join(root, 'demo-festival.json'));
    mkdirSync(path.join(root, 'golden'));
    writeFileSync(
      path.join(root, 'golden', 'index.json'),
      JSON.stringify({
        version: 1,
        festivals: [
          { slug: 'demo-festival', festival_id: '11111111-1111-4111-8111-111111111111', name: 'Other', seed_file: 'seed-data/demo-festival.json', csv_dir: null, candidate: null, promoted_at: '2026-01-01T00:00:00Z', verified: null },
        ],
      }),
    );
    await expect(promoteCandidate('demo-festival', { dryRun: false, root })).rejects.toThrow(/index\.json lists demo-festival with festival id 11111111/);
    expect(existsSync(path.join(root, 'demo-festival.json'))).toBe(false);
    expect(readGoldenIndex(root).festivals[0].name).toBe('Other');
  });

  it('refuses approved media that media:validate rejects, before writing anything', async () => {
    const seed = seedOf(demoCsv());
    const dir = writeCandidate('demo-festival', demoCsv(), APPROVED);
    const promote = () => promoteCandidate('demo-festival', { dryRun: false, root });
    const artist = seed.artists[0];

    writeMedia(dir, [mediaEntry(seed)], false);
    await expect(promote()).rejects.toThrow(/media:validate rejects[\s\S]*entries\[0\]\.file: file not found/);
    writeMedia(dir, [mediaEntry(seed, { sha256: 'deadbeef' })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.sha256: must be 64 lowercase hex characters/);
    writeMedia(dir, [mediaEntry(seed, { sha256: '' })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.sha256: must be 64 lowercase hex characters/);
    writeMedia(dir, [mediaEntry(seed, { sha256: '0'.repeat(64) })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.sha256: does not match the file/);
    writeMedia(dir, [mediaEntry(seed, { subject_id: '99999999-9999-4999-8999-999999999999', file: 'artists/99999999-9999-4999-8999-999999999999.png' })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.subject_id: no artist with this id in the seed files/);
    writeMedia(dir, [mediaEntry(seed, { subject_type: 'festival', file: `festivals/${artist.id}.png` })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.subject_type: .* is a artist, not a festival/);
    writeMedia(dir, [mediaEntry(seed, { review: { status: 'approved', by: null, at: '2026-10-12T11:00:00Z' } })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.review\.by: an approved entry records who approved it/);
    writeMedia(dir, [mediaEntry(seed, { license: { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: null } })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.license\.attribution: CC-BY-4.0 requires attribution text/);
    writeMedia(dir, [mediaEntry(seed, { mime: 'image/jpeg', file: `artists/${artist.id}.jpg` })]);
    await expect(promote()).rejects.toThrow(/entries\[0\]\.mime: file is image\/png, not image\/jpeg/);
    writeMedia(dir, [mediaEntry(seed), mediaEntry(seed)]);
    await expect(promote()).rejects.toThrow(/entries\[1\]\.review\.status: a second approved entry for artist/);
    expect(existsSync(path.join(root, 'media'))).toBe(false);
    expect(existsSync(path.join(root, 'demo-festival.json'))).toBe(false);
    expect(readJson(path.join(dir, 'candidate.json')).status).toBe('approved');

    // Problems in pending or rejected entries do not block: they are not merged.
    writeMedia(dir, [mediaEntry(seed, { sha256: 'bogus', review: { status: 'pending', by: null, at: null } }), mediaEntry(seed)]);
    const result = await promoteCandidate('demo-festival', { dryRun: true, root });
    expect(result.mediaMerged).toBe(1);
    expect(result.actions).toContain(`copy media/artists/${artist.id}.png to seed-data/media/artists/${artist.id}.png`);
  });

  it('refuses approved media whose path escapes media/ or is a symbolic link, and writes nothing', async () => {
    const seed = seedOf(demoCsv());
    const dir = writeCandidate('demo-festival', demoCsv(), APPROVED);
    const promote = (dryRun: boolean) => promoteCandidate('demo-festival', { dryRun, root });
    const victim = path.join(root, 'x.json');
    writeFileSync(victim, '{"festival":{"id":"victim"}}');
    const pattern = /entries\[0\]\.file: must match <artists\|festivals>\/<uuid>\.<jpg\|png\|webp>/;

    // `file` names the destination too: `../x.json` would land on seed-data/x.json.
    writeMedia(dir, [mediaEntry(seed, { file: '../x.json' })]);
    await expect(promote(false)).rejects.toThrow(pattern);
    await expect(promote(true)).rejects.toThrow(pattern);
    writeMedia(dir, [mediaEntry(seed, { file: '../../evil/x' })], false);
    await expect(promote(false)).rejects.toThrow(pattern);
    writeMedia(dir, [mediaEntry(seed, { file: `artists/../../${seed.artists[0].id}.png` })]);
    await expect(promote(false)).rejects.toThrow(pattern);
    writeMedia(dir, [mediaEntry(seed, { file: `/etc/${seed.artists[0].id}.png` })], false);
    await expect(promote(false)).rejects.toThrow(pattern);

    // A symbolic link in place of the image, and a symlinked folder: both read fine, both refused.
    const outside = path.join(tmp, 'outside.png');
    writeFileSync(outside, PNG);
    writeMedia(dir, [mediaEntry(seed)], false);
    rmSync(path.join(dir, 'media', 'artists'), { recursive: true, force: true });
    mkdirSync(path.join(dir, 'media', 'artists'), { recursive: true });
    symlinkSync(outside, path.join(dir, 'media', 'artists', `${seed.artists[0].id}.png`));
    await expect(promote(false)).rejects.toThrow(/is a symbolic link/);
    const outsideDir = path.join(tmp, 'outside-dir');
    mkdirSync(outsideDir);
    writeFileSync(path.join(outsideDir, `${seed.festival.id}.png`), PNG);
    writeMedia(dir, [mediaEntry(seed, { subject_type: 'festival', subject_id: seed.festival.id, subject_name: seed.festival.name, file: `festivals/${seed.festival.id}.png` })], false);
    symlinkSync(outsideDir, path.join(dir, 'media', 'festivals'));
    await expect(promote(false)).rejects.toThrow(/outside the candidate's media directory/);

    expect(readFileSync(victim, 'utf8')).toBe('{"festival":{"id":"victim"}}');
    expect(existsSync(path.join(root, 'media'))).toBe(false);
    expect(existsSync(path.join(root, 'demo-festival.json'))).toBe(false);
    expect(existsSync(path.join(root, 'golden'))).toBe(false);
    expect(readJson(path.join(dir, 'candidate.json')).status).toBe('approved');
  });
});

describe('evaluateCandidate', () => {
  const goldenCsv: CsvInput = {
    'festival.csv': 'name,start_date,end_date,timezone,venue_name,source_url,status\nRiverside Sounds,2027-08-06,2027-08-07,America/Chicago,Riverside Park,https://example.org/schedule,draft\n',
    'stages.csv': 'name\nMain\nTent\n',
    'artists.csv': 'name\nArtist One\nArtist Two\nArtist Three\nArtist Four\nArtist Five\n',
    'sets.csv': [
      'artist,stage,start,end',
      'Artist One,Main,2027-08-06 19:00,2027-08-06 20:00',
      'Artist Two,Tent,2027-08-06 20:00,2027-08-06 21:00',
      'Artist Three,Main,2027-08-06 21:00,2027-08-06 22:00',
      'Artist Four,Tent,2027-08-07 01:00,2027-08-07 02:00',
      'Artist Five,Main,2027-08-07 19:00,2027-08-07 20:00',
      'Artist One,Main,2027-08-07 21:00,2027-08-07 22:00',
      '',
    ].join('\n'),
  };
  const candidateCsv: CsvInput = {
    'festival.csv': 'name,start_date,end_date,timezone,venue_name,source_url,status\n"Riverside  Sounds",2027-08-06,2027-08-08,America/Chicago,riverside park,https://example.org/schedule,draft\n',
    'stages.csv': 'name\nMain\nTent\nSilent Disco\n',
    'artists.csv': 'name\nArtist One\nArtist Two\nArtist Three\nArtist Four\nArtist Six\n',
    'sets.csv': [
      'artist,stage,start,end',
      'Artist One,Main,2027-08-06 19:00,2027-08-06 20:00', // exact
      'Artist Two,Tent,2027-08-06 20:25,2027-08-06 21:25', // 25 minutes late
      'Artist Three,Tent,2027-08-06 21:00,2027-08-06 22:00', // wrong stage
      'Artist Four,Tent,2027-08-07 22:00,2027-08-07 23:00', // moved to another festival day (golden: Fri night 1 AM)
      'Artist One,Main,2027-08-07 21:05,2027-08-07 22:05', // within tolerance
      '',
    ].join('\n'),
  };

  function goldenFile(): string {
    const file = path.join(tmp, 'riverside-golden.json');
    writeFileSync(file, `${JSON.stringify(seedOf(goldenCsv), null, 2)}\n`);
    return file;
  }

  it('compares festival fields, stages, artists and sets', async () => {
    writeCandidate('riverside', candidateCsv);
    const report = await evaluateCandidate('riverside', goldenFile(), { root });

    expect(report.candidate).toBe('riverside');
    expect(report.tolerance_minutes).toBe(10);
    expect(report.festival_fields.map((f) => [f.field, f.match])).toEqual([
      ['name', true],
      ['start_date', true],
      ['end_date', false],
      ['timezone', true],
      ['venue_name', true],
    ]);
    expect(report.festival_fields[2]).toMatchObject({ candidate: '2027-08-08', golden: '2027-08-07' });

    expect(report.stages.precision).toBeCloseTo(2 / 3);
    expect(report.stages.recall).toBe(1);
    expect(report.stages.missing).toEqual([]);
    expect(report.stages.extra).toEqual(['Silent Disco']);

    expect(report.artists.precision).toBeCloseTo(0.8);
    expect(report.artists.recall).toBeCloseTo(0.8);
    expect(report.artists.missing).toEqual(['Artist Five']);
    expect(report.artists.extra).toEqual(['Artist Six']);

    expect(report.sets.precision).toBeCloseTo(4 / 5);
    expect(report.sets.recall).toBeCloseTo(4 / 6);
    expect(report.sets.exact).toBe(3);
    expect(report.sets.time_errors).toEqual([
      { artist: 'Artist Two', golden_start: '2027-08-06T20:00:00-05:00', candidate_start: '2027-08-06T20:25:00-05:00', minutes_off: 25 },
    ]);
    expect(report.sets.stage_mismatches).toEqual([{ artist: 'Artist Three', golden_stage: 'Main', candidate_stage: 'Tent' }]);
    expect(report.sets.missing).toEqual([
      'Artist Four @ 2027-08-07T01:00:00-05:00 on Tent',
      'Artist Five @ 2027-08-07T19:00:00-05:00 on Main',
    ]);
    expect(report.sets.extra).toEqual(['Artist Four @ 2027-08-07T22:00:00-05:00 on Tent']);

    const text = formatEvalReport(report);
    expect(text).toContain('DIFF end_date');
    expect(text).toContain('Stages: precision 66.7%, recall 100%');
    expect(text).toContain('Artist Two: golden 2027-08-06T20:00:00-05:00, candidate 2027-08-06T20:25:00-05:00 (+25 min)');
    expect(text).toContain('Artist Three: golden Main, candidate Tent');
    expect(text).toContain('- Artist Five @ 2027-08-07T19:00:00-05:00 on Main');
  });

  it('honours the tolerance', async () => {
    writeCandidate('riverside', candidateCsv);
    const report = await evaluateCandidate('riverside', goldenFile(), { root, toleranceMinutes: 30 });
    expect(report.tolerance_minutes).toBe(30);
    expect(report.sets.time_errors).toEqual([]);
    expect(report.sets.exact).toBe(4);
    await expect(evaluateCandidate('riverside', goldenFile(), { root, toleranceMinutes: -1 })).rejects.toThrow(/tolerance/);
  });

  it('is perfect against itself and refuses invalid inputs', async () => {
    writeCandidate('riverside', goldenCsv);
    const report = await evaluateCandidate('riverside', goldenFile(), { root });
    expect(report.festival_fields.every((f) => f.match)).toBe(true);
    expect(report.stages).toEqual({ precision: 1, recall: 1, missing: [], extra: [] });
    expect(report.artists).toEqual({ precision: 1, recall: 1, missing: [], extra: [] });
    expect(report.sets).toMatchObject({ precision: 1, recall: 1, exact: 6, time_errors: [], stage_mismatches: [], missing: [], extra: [] });

    const csv = { ...goldenCsv, 'sets.csv': `${goldenCsv['sets.csv']}Nobody,Main,2027-08-07 10:00,2027-08-07 11:00\n` };
    writeCandidate('broken', csv);
    await expect(evaluateCandidate('broken', goldenFile(), { root })).rejects.toThrow(/does not build a valid festival/);
    const badGolden = path.join(tmp, 'bad.json');
    writeFileSync(badGolden, '{"festival": {}}');
    await expect(evaluateCandidate('riverside', badGolden, { root })).rejects.toThrow(/not a valid festival file/);
  });
});
