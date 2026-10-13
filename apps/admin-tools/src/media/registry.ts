/**
 * Reading and writing `seed-data/media/registry.json` (schema in ./types.ts) plus the byte-level
 * helpers the registry rules need: checksums, image type sniffing and image dimensions. Nothing here
 * touches the network or the database.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readJsonFile, repoRoot, UsageError } from '../env';
import { MEDIA_REGISTRY_VERSION, type MediaEntry, type MediaRegistry, type MediaSubjectType } from './types';

export type MediaMime = MediaEntry['mime'];
export type MediaExtension = 'jpg' | 'png' | 'webp';

export const MIME_EXTENSIONS: Readonly<Record<MediaMime, MediaExtension>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `seed-data/media/registry.json` in this repository. */
export function defaultRegistryFile(): string {
  return path.join(repoRoot(), 'seed-data', 'media', 'registry.json');
}

/** The directory entry files are relative to (and the bucket mirrors): the registry's own directory. */
export function registryDir(file: string): string {
  return path.dirname(path.resolve(file));
}

export function emptyRegistry(): MediaRegistry {
  return { version: MEDIA_REGISTRY_VERSION, entries: [] };
}

/**
 * Loose shape check so callers can index `entries`; `validateRegistry` checks every field. A file that
 * fails this is not a registry at all (wrong version, no entries array).
 */
export function isRegistryShape(value: unknown): value is MediaRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === MEDIA_REGISTRY_VERSION &&
    Array.isArray((value as { entries?: unknown }).entries)
  );
}

export function readRegistry(file: string = defaultRegistryFile()): MediaRegistry {
  const parsed = readJsonFile(file);
  if (!isRegistryShape(parsed)) {
    throw new UsageError(
      `${file} is not a media registry: expected {"version": ${MEDIA_REGISTRY_VERSION}, "entries": [...]}`,
    );
  }
  return parsed;
}

/** A registry that does not exist yet (a new candidate's media directory) reads as empty. */
export function readRegistryOrEmpty(file: string): MediaRegistry {
  return existsSync(file) ? readRegistry(file) : emptyRegistry();
}

/** Pretty JSON with a trailing newline (same style as the festival seed files); creates the directory. */
export function writeRegistry(registry: MediaRegistry, file: string = defaultRegistryFile()): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export function sha256Of(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Storage's eTag for a single-part upload is the MD5 of the body; used to spot unchanged objects. */
export function md5Of(buffer: Uint8Array): string {
  return createHash('md5').update(buffer).digest('hex');
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function ascii(buffer: Uint8Array, start: number, end: number): string {
  return Buffer.from(buffer.subarray(start, end)).toString('latin1');
}

/** Image type from magic bytes; null for anything that is not a JPEG, PNG or WebP. */
export function sniffMime(buffer: Uint8Array): MediaMime | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function extensionFor(mime: MediaMime): MediaExtension {
  return MIME_EXTENSIONS[mime];
}

export interface ImageSize {
  width: number;
  height: number;
}

function jpegDimensions(buffer: Uint8Array): ImageSize | null {
  const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 2;
  while (offset + 4 <= view.length) {
    if (view[offset] !== 0xff) {
      return null;
    }
    const marker = view[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // standalone marker, no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null; // end of image / start of scan without a frame header
    }
    const length = view.readUInt16BE(offset + 2);
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > view.length) {
        return null;
      }
      return { height: view.readUInt16BE(offset + 5), width: view.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function pngDimensions(buffer: Uint8Array): ImageSize | null {
  if (buffer.length < 24 || ascii(buffer, 12, 16) !== 'IHDR') {
    return null;
  }
  const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}

function webpDimensions(buffer: Uint8Array): ImageSize | null {
  if (buffer.length < 25) {
    return null;
  }
  const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const chunk = ascii(buffer, 12, 16);
  if (chunk === 'VP8 ') {
    if (view.length < 30 || view[23] !== 0x9d || view[24] !== 0x01 || view[25] !== 0x2a) {
      return null;
    }
    return { width: view.readUInt16LE(26) & 0x3fff, height: view.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (view[20] !== 0x2f) {
      return null;
    }
    const b0 = view[21];
    const b1 = view[22];
    const b2 = view[23];
    const b3 = view[24];
    return { width: 1 + (b0 | ((b1 & 0x3f) << 8)), height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) };
  }
  if (chunk === 'VP8X') {
    if (view.length < 30) {
      return null;
    }
    return { width: 1 + view.readUIntLE(24, 3), height: 1 + view.readUIntLE(27, 3) };
  }
  return null;
}

/** Pixel size read from the file header; null when the header cannot be parsed. */
export function imageDimensions(buffer: Uint8Array): ImageSize | null {
  const mime = sniffMime(buffer);
  if (mime === 'image/jpeg') {
    return jpegDimensions(buffer);
  }
  if (mime === 'image/png') {
    return pngDimensions(buffer);
  }
  if (mime === 'image/webp') {
    return webpDimensions(buffer);
  }
  return null;
}

export function subjectKey(subjectType: MediaSubjectType, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

export function entriesFor(registry: MediaRegistry, subjectType: MediaSubjectType, subjectId: string): MediaEntry[] {
  return registry.entries.filter((entry) => entry.subject_type === subjectType && entry.subject_id === subjectId);
}

/**
 * The entry that counts for a subject: its approved entry when there is one, otherwise the first entry
 * for it (pending or rejected), otherwise undefined.
 */
export function findEntry(registry: MediaRegistry, subjectType: MediaSubjectType, subjectId: string): MediaEntry | undefined {
  const matches = entriesFor(registry, subjectType, subjectId);
  return matches.find((entry) => entry.review?.status === 'approved') ?? matches[0];
}

export interface UpsertResult {
  /** Index of the entry in `registry.entries` after the operation. */
  index: number;
  /** Entries for the same subject that were replaced (in their previous order). */
  replaced: MediaEntry[];
}

/**
 * Replaces every entry for the entry's subject with `entry` (at the position of the first one) or
 * appends it. A subject has one current entry; the fetcher re-run replaces rejected or pending ones.
 */
export function upsertEntry(registry: MediaRegistry, entry: MediaEntry): UpsertResult {
  const replaced: MediaEntry[] = [];
  let index = -1;
  const entries: MediaEntry[] = [];
  for (const existing of registry.entries) {
    if (existing.subject_type === entry.subject_type && existing.subject_id === entry.subject_id) {
      replaced.push(existing);
      if (index === -1) {
        index = entries.length;
        entries.push(entry);
      }
      continue;
    }
    entries.push(existing);
  }
  if (index === -1) {
    index = entries.length;
    entries.push(entry);
  }
  registry.entries = entries;
  return { index, replaced };
}
