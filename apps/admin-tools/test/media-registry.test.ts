import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  emptyRegistry,
  entriesFor,
  findEntry,
  imageDimensions,
  isRegistryShape,
  md5Of,
  readRegistry,
  readRegistryOrEmpty,
  registryDir,
  sha256Of,
  sniffMime,
  upsertEntry,
  writeRegistry,
} from '../src/media/registry';
import type { MediaEntry, MediaRegistry } from '../src/media/types';
import { tinyJpeg, tinyPng, tinyWebp } from './media-fixtures';

const A1 = '33333333-3333-4333-8333-333333333331';
const A2 = '33333333-3333-4333-8333-333333333332';

function entry(overrides: Partial<MediaEntry> = {}): MediaEntry {
  return {
    subject_type: 'artist',
    subject_id: A1,
    subject_name: 'Artist One',
    file: `artists/${A1}.jpg`,
    sha256: 'a'.repeat(64),
    mime: 'image/jpeg',
    width: 1,
    height: 1,
    source: { kind: 'wikimedia-commons', url: 'https://commons.wikimedia.org/wiki/File:X.jpg', page_url: null, retrieved_at: '2026-10-01T00:00:00Z', note: null },
    license: { id: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'Photo: Jane, CC BY-SA 4.0, via Wikimedia Commons' },
    review: { status: 'pending', by: null, at: null, note: null },
    ...overrides,
  };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'festie-media-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('registry read/write', () => {
  it('round-trips pretty JSON with a trailing newline and creates the directory', () => {
    const file = path.join(tempDir(), 'nested', 'registry.json');
    const registry: MediaRegistry = { version: 1, entries: [entry()] };
    writeRegistry(registry, file);
    const text = readFileSync(file, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "entries": [\n');
    expect(readRegistry(file)).toEqual(registry);
    expect(registryDir(file)).toBe(path.join(path.dirname(file)));
  });

  it('rejects files that are not a registry and reads a missing one as empty', () => {
    const dir = tempDir();
    const file = path.join(dir, 'registry.json');
    writeFileSync(file, '{"version": 2, "entries": []}');
    expect(() => readRegistry(file)).toThrow('is not a media registry');
    writeFileSync(file, '[]');
    expect(() => readRegistry(file)).toThrow('is not a media registry');
    writeFileSync(file, '{not json');
    expect(() => readRegistry(file)).toThrow('not valid JSON');
    expect(() => readRegistry(path.join(dir, 'missing.json'))).toThrow('File not found');
    expect(readRegistryOrEmpty(path.join(dir, 'missing.json'))).toEqual(emptyRegistry());
    expect(isRegistryShape({ version: 1, entries: [] })).toBe(true);
    expect(isRegistryShape({ version: 1 })).toBe(false);
  });
});

describe('checksums and sniffing', () => {
  it('hashes bytes', () => {
    expect(sha256Of(Buffer.from(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(md5Of(Buffer.from(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('sniffs JPEG, PNG and WebP by magic bytes and nothing else', () => {
    expect(sniffMime(tinyJpeg())).toBe('image/jpeg');
    expect(sniffMime(tinyPng())).toBe('image/png');
    expect(sniffMime(tinyWebp())).toBe('image/webp');
    expect(sniffMime(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffMime(Buffer.from('RIFF....WAVE'))).toBeNull();
    expect(sniffMime(Buffer.alloc(0))).toBeNull();
  });

  it('reads dimensions from the headers', () => {
    expect(imageDimensions(tinyJpeg(512, 341))).toEqual({ width: 512, height: 341 });
    expect(imageDimensions(tinyPng(3, 2))).toEqual({ width: 3, height: 2 });
    expect(imageDimensions(tinyWebp(500, 320))).toEqual({ width: 500, height: 320 });
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(imageDimensions(Buffer.from('nope'))).toBeNull();
  });
});

describe('findEntry and upsertEntry', () => {
  it('prefers the approved entry for a subject', () => {
    const rejected = entry({ review: { status: 'rejected', by: 'kev', at: '2026-10-01T00:00:00Z' } });
    const approved = entry({ file: `artists/${A1}.png`, mime: 'image/png', review: { status: 'approved', by: 'kev', at: '2026-10-02T00:00:00Z' } });
    const registry: MediaRegistry = { version: 1, entries: [rejected, approved, entry({ subject_id: A2 })] };
    expect(findEntry(registry, 'artist', A1)).toBe(approved);
    expect(findEntry(registry, 'artist', A2)?.subject_id).toBe(A2);
    expect(findEntry(registry, 'festival', A1)).toBeUndefined();
    expect(entriesFor(registry, 'artist', A1)).toEqual([rejected, approved]);
  });

  it('replaces every entry of the subject in place or appends', () => {
    const registry: MediaRegistry = { version: 1, entries: [entry({ subject_id: A2 }), entry(), entry({ file: `artists/${A1}.png`, mime: 'image/png' })] };
    const fresh = entry({ sha256: 'b'.repeat(64) });
    const result = upsertEntry(registry, fresh);
    expect(result.index).toBe(1);
    expect(result.replaced).toHaveLength(2);
    expect(registry.entries).toEqual([entry({ subject_id: A2 }), fresh]);

    const festival = entry({ subject_type: 'festival', subject_id: A1, file: `festivals/${A1}.jpg` });
    expect(upsertEntry(registry, festival)).toEqual({ index: 2, replaced: [] });
    expect(registry.entries[2]).toBe(festival);
    expect(existsSync(registryDir(path.join(tempDir(), 'registry.json')))).toBe(true);
  });
});
