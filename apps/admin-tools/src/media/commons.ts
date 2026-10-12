/**
 * Licence-aware artist photo fetcher: Wikidata (artist → P18 image) and Wikimedia Commons (licence,
 * author, 512 px thumbnail). Produces a *pending* registry entry; a human approves it before
 * `media:upload` touches anything. Only CC0, public domain, CC BY and CC BY-SA are accepted — NC forbids
 * a commercial app, ND forbids the crop, anything unknown is refused rather than guessed.
 *
 * Wikimedia asks API clients for a descriptive User-Agent and a gentle request rate; `CommonsClient`
 * sends the agent on every call and waits at least `minIntervalMs` between calls.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { extensionFor, imageDimensions, sha256Of, sniffMime } from './registry';
import { ALLOWED_LICENSES, ARTWORK_MAX_BYTES, ARTWORK_MAX_SIDE, IMAGE_CREDIT_MAX_LENGTH, type LicenseId, type MediaEntry } from './types';

export const DEFAULT_USER_AGENT = 'Festie-admin-tools/0.1 (+https://joinfestie.com; support@joinfestie.com)';
export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const MIN_REQUEST_INTERVAL_MS = 1000;
/** Thumbnail width requested from Commons (never upscaled; smaller originals come back as they are). */
export const THUMB_WIDTH = ARTWORK_MAX_SIDE;

/** Descriptions that mark a Wikidata search hit as a music act. */
export const MUSIC_DESCRIPTION_PATTERN =
  /\b(musician|dj|band|singer|rapper|producer|duo|trio|songwriter|music(?:al)? (?:group|project|artist|ensemble|act|collective))\b/i;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer | SharedArrayBuffer>;
}

/** The subset of `fetch` the fetcher uses; the global fetch (Node ≥ 18) fits. */
export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect?: 'follow' }) => Promise<FetchResponseLike>;

export interface CommonsClientOptions {
  fetch?: FetchLike;
  userAgent?: string;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class CommonsClient {
  readonly userAgent: string;
  readonly calls: string[] = [];
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastCallAt = Number.NEGATIVE_INFINITY;

  constructor(options: CommonsClientOptions = {}) {
    const globalFetch = (globalThis as { fetch?: unknown }).fetch as FetchLike | undefined;
    const impl = options.fetch ?? globalFetch;
    if (!impl) {
      throw new Error('No fetch implementation available (Node 18+ or pass options.fetch)');
    }
    this.fetchImpl = impl;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.minIntervalMs = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastCallAt + this.minIntervalMs - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    this.lastCallAt = this.now();
  }

  private async request(url: string, accept: string): Promise<FetchResponseLike> {
    await this.throttle();
    this.calls.push(url);
    const response = await this.fetchImpl(url, {
      headers: { 'User-Agent': this.userAgent, 'Api-User-Agent': this.userAgent, Accept: accept },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    }
    return response;
  }

  async getJson(url: string): Promise<unknown> {
    return (await this.request(url, 'application/json')).json();
  }

  async getBytes(url: string): Promise<Buffer> {
    return Buffer.from(await (await this.request(url, 'image/*')).arrayBuffer());
  }
}

function query(base: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `${base}?${search.toString()}`;
}

export interface WikidataSearchHit {
  id: string;
  label: string;
  description: string;
}

export interface WikidataSearchResult {
  hits: WikidataSearchHit[];
  /** The first hit whose description reads like a music act. */
  picked: WikidataSearchHit | null;
}

export async function searchWikidata(client: CommonsClient, name: string): Promise<WikidataSearchResult> {
  const data = (await client.getJson(
    query(WIKIDATA_API, { action: 'wbsearchentities', search: name, language: 'en', type: 'item', format: 'json', limit: '5' }),
  )) as { search?: Array<{ id?: unknown; label?: unknown; description?: unknown }> };
  const hits: WikidataSearchHit[] = (data.search ?? [])
    .filter((hit) => typeof hit.id === 'string')
    .map((hit) => ({
      id: hit.id as string,
      label: typeof hit.label === 'string' ? hit.label : '',
      description: typeof hit.description === 'string' ? hit.description : '',
    }));
  return { hits, picked: hits.find((hit) => MUSIC_DESCRIPTION_PATTERN.test(hit.description)) ?? null };
}

export interface WikidataEntityImage {
  /** Commons file name without the `File:` prefix. */
  fileName: string | null;
  musicbrainzId: string | null;
}

interface Claim {
  rank?: string;
  mainsnak?: { datavalue?: { value?: unknown } };
}

function claimValue(claims: Claim[] | undefined): string | null {
  if (!Array.isArray(claims) || claims.length === 0) {
    return null;
  }
  const ordered = [...claims].sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank));
  for (const claim of ordered) {
    if (claim.rank === 'deprecated') {
      continue;
    }
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

function rankOrder(rank: string | undefined): number {
  return rank === 'preferred' ? 0 : rank === 'deprecated' ? 2 : 1;
}

export async function getEntityImage(client: CommonsClient, wikidataId: string): Promise<WikidataEntityImage> {
  const data = (await client.getJson(
    query(WIKIDATA_API, { action: 'wbgetentities', ids: wikidataId, props: 'claims|sitelinks', format: 'json' }),
  )) as { entities?: Record<string, { missing?: unknown; claims?: Record<string, Claim[]> }> };
  const entity = data.entities?.[wikidataId];
  if (!entity || entity.missing !== undefined) {
    throw new Error(`Wikidata entity ${wikidataId} not found`);
  }
  return { fileName: claimValue(entity.claims?.P18), musicbrainzId: claimValue(entity.claims?.P434) };
}

export interface CommonsImageInfo {
  fileName: string;
  /** `https://commons.wikimedia.org/wiki/File:<name>` */
  filePageUrl: string;
  thumbUrl: string;
  thumbWidth: number | null;
  thumbHeight: number | null;
  originalUrl: string | null;
  mime: string | null;
  licenseShortName: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** Plain text (Commons returns HTML). */
  artist: string | null;
  credit: string | null;
  attributionRequired: boolean | null;
  restrictions: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Drops tags, decodes the common entities and collapses whitespace. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
      if (code.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function commonsFilePageUrl(fileName: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
}

function metaText(meta: Record<string, { value?: unknown }> | undefined, key: string): string | null {
  const value = meta?.[key]?.value;
  if (typeof value !== 'string') {
    return null;
  }
  const text = stripHtml(value);
  return text === '' ? null : text;
}

export async function getImageInfo(client: CommonsClient, fileName: string): Promise<CommonsImageInfo | null> {
  const data = (await client.getJson(
    query(COMMONS_API, {
      action: 'query',
      titles: `File:${fileName}`,
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(THUMB_WIDTH),
      format: 'json',
    }),
  )) as { query?: { pages?: Record<string, { missing?: unknown; imageinfo?: Array<Record<string, unknown>> }> } };
  const pages = Object.values(data.query?.pages ?? {});
  const page = pages.find((candidate) => Array.isArray(candidate.imageinfo) && candidate.imageinfo.length > 0);
  const info = page?.imageinfo?.[0];
  if (!info || typeof info.thumburl !== 'string') {
    return null;
  }
  const meta = info.extmetadata as Record<string, { value?: unknown }> | undefined;
  const attributionRequired = metaText(meta, 'AttributionRequired');
  const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    fileName,
    filePageUrl: commonsFilePageUrl(fileName),
    thumbUrl: info.thumburl,
    thumbWidth: number(info.thumbwidth),
    thumbHeight: number(info.thumbheight),
    originalUrl: typeof info.url === 'string' ? info.url : null,
    mime: typeof info.mime === 'string' ? info.mime : null,
    licenseShortName: metaText(meta, 'LicenseShortName'),
    license: metaText(meta, 'License'),
    licenseUrl: metaText(meta, 'LicenseUrl'),
    artist: metaText(meta, 'Artist'),
    credit: metaText(meta, 'Credit'),
    attributionRequired: attributionRequired === null ? null : attributionRequired.toLowerCase() === 'true',
    restrictions: metaText(meta, 'Restrictions'),
  };
}

export type LicenseMapping =
  | { ok: true; id: LicenseId; url: string | null; label: string }
  | { ok: false; reason: string };

/**
 * Maps Commons' licence fields to a registry licence id. Ported CC variants ("CC BY-SA 3.0 de") map to
 * the base version. Anything NC, ND or unrecognised is refused.
 */
export function mapLicense(shortName: string | null, license: string | null): LicenseMapping {
  const label = shortName ?? license ?? '';
  const text = `${shortName ?? ''} ${license ?? ''}`.toLowerCase();
  if (text.trim() === '') {
    return { ok: false, reason: 'no licence information on the Commons file page' };
  }
  if (/(^|[\s-])nc([\s-]|$)|non-?commercial/.test(text)) {
    return { ok: false, reason: `${label} is non-commercial (NC); Festie is a commercial app` };
  }
  if (/(^|[\s-])nd([\s-]|$)|no-?deriv/.test(text)) {
    return { ok: false, reason: `${label} forbids derivatives (ND); the app crops and resizes` };
  }
  if (/cc0|cc-zero|creative commons zero/.test(text)) {
    return { ok: true, id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', label: shortName ?? 'CC0' };
  }
  if (/public domain|(^|[\s-])pd([\s-]|$)/.test(text)) {
    return { ok: true, id: 'public-domain', url: null, label: shortName ?? 'Public domain' };
  }
  const cc = /cc[\s-]by(?<sa>[\s-]sa)?[\s-](?<version>\d\.\d)/.exec(text);
  if (cc?.groups) {
    const sa = Boolean(cc.groups.sa);
    const version = cc.groups.version;
    const id = `CC-BY${sa ? '-SA' : ''}-${version}`;
    if ((ALLOWED_LICENSES as readonly string[]).includes(id)) {
      return {
        ok: true,
        id: id as LicenseId,
        url: `https://creativecommons.org/licenses/by${sa ? '-sa' : ''}/${version}/`,
        label: shortName ?? `CC BY${sa ? '-SA' : ''} ${version}`,
      };
    }
    return { ok: false, reason: `${label} is not in the allowed licence list` };
  }
  return { ok: false, reason: `unrecognised licence "${label}"; add it to seed-data/media/README.md only after a rights check` };
}

/**
 * `Photo: <author>, <licence>, via Wikimedia Commons`, trimmed to the image_credit limit. Without an
 * author (possible for public-domain files) the credit is `Photo: <licence>, via Wikimedia Commons`.
 */
export function buildAttribution(author: string | null, licenseLabel: string): string {
  const suffix = `${licenseLabel}, via Wikimedia Commons`;
  const prefix = 'Photo: ';
  let name = (author ?? '').trim();
  if (name === '') {
    return `${prefix}${suffix}`;
  }
  const room = IMAGE_CREDIT_MAX_LENGTH - prefix.length - suffix.length - 2;
  if (name.length > room) {
    name = `${name.slice(0, room - 1).trimEnd()}…`;
  }
  return `${prefix}${name}, ${suffix}`;
}

export type CommonsStage = 'search' | 'entity' | 'imageinfo' | 'license' | 'download';

export interface CommonsFetchFailure {
  ok: false;
  stage: CommonsStage;
  reason: string;
  wikidataId: string | null;
  fileName: string | null;
  /** The licence label Commons reported (for the summary of rejected licences). */
  license: string | null;
}

export interface CommonsFetchSuccess {
  ok: true;
  entry: MediaEntry;
  wikidataId: string;
  fileName: string;
  musicbrainzId: string | null;
  /** Absolute path of the written file. */
  writtenFile: string;
}

export type CommonsFetchResult = CommonsFetchSuccess | CommonsFetchFailure;

export interface FetchCommonsCandidateOptions {
  artistName: string;
  /** `artists.id`; the file is written to `<into>/artists/<artistId>.<ext>`. */
  artistId: string;
  wikidataId?: string | null;
  /** The media directory (the registry's directory). */
  into: string;
  fetch?: FetchLike;
  userAgent?: string;
  /** A shared client keeps the rate limit across several artists. */
  client?: CommonsClient;
  now?: () => Date;
}

/**
 * Finds the artist on Wikidata (unless `wikidataId` is given), reads its P18 image, checks the licence
 * on Commons, downloads the 512 px thumbnail and writes it under `into`. Returns a pending entry or the
 * reason nothing was written.
 */
export async function fetchCommonsCandidate(options: FetchCommonsCandidateOptions): Promise<CommonsFetchResult> {
  const client = options.client ?? new CommonsClient({ fetch: options.fetch, userAgent: options.userAgent });
  const now = options.now ?? (() => new Date());
  const fail = (stage: CommonsStage, reason: string, extra: Partial<CommonsFetchFailure> = {}): CommonsFetchFailure => ({
    ok: false,
    stage,
    reason,
    wikidataId: null,
    fileName: null,
    license: null,
    ...extra,
  });

  let wikidataId = options.wikidataId?.trim() || null;
  let searchNote: string | null = null;
  if (!wikidataId) {
    const search = await searchWikidata(client, options.artistName);
    if (!search.picked) {
      const seen = search.hits.map((hit) => `${hit.id} "${hit.label}" (${hit.description || 'no description'})`).join(', ');
      return fail('search', search.hits.length === 0 ? 'no Wikidata item found' : `no Wikidata hit described as a music act; saw ${seen}`);
    }
    wikidataId = search.picked.id;
    searchNote = `Wikidata ${wikidataId} "${search.picked.label}" (${search.picked.description})`;
  }
  if (!/^Q\d+$/.test(wikidataId)) {
    return fail('entity', `"${wikidataId}" is not a Wikidata item id (Q…)`, { wikidataId });
  }

  const entity = await getEntityImage(client, wikidataId);
  if (!entity.fileName) {
    return fail('entity', `Wikidata ${wikidataId} has no image (P18)`, { wikidataId });
  }

  const info = await getImageInfo(client, entity.fileName);
  if (!info) {
    return fail('imageinfo', `Commons has no image info for File:${entity.fileName}`, { wikidataId, fileName: entity.fileName });
  }

  const license = mapLicense(info.licenseShortName, info.license);
  if (!license.ok) {
    return fail('license', license.reason, { wikidataId, fileName: entity.fileName, license: info.licenseShortName ?? info.license });
  }
  const author = info.artist ?? info.credit;
  if (!author && (license.id.startsWith('CC-BY'))) {
    return fail('license', `${license.label} requires attribution but Commons lists no author`, {
      wikidataId,
      fileName: entity.fileName,
      license: license.label,
    });
  }

  const bytes = await client.getBytes(info.thumbUrl);
  const mime = sniffMime(bytes);
  if (!mime) {
    return fail('download', `thumbnail is not a JPEG, PNG or WebP (${info.mime ?? 'unknown type'})`, { wikidataId, fileName: entity.fileName });
  }
  if (bytes.length > ARTWORK_MAX_BYTES) {
    return fail('download', `thumbnail is ${bytes.length} bytes; the limit is ${ARTWORK_MAX_BYTES}`, { wikidataId, fileName: entity.fileName });
  }
  const size = imageDimensions(bytes);
  const width = size?.width ?? info.thumbWidth;
  const height = size?.height ?? info.thumbHeight;
  if (width !== null && height !== null && Math.max(width, height) > ARTWORK_MAX_SIDE) {
    return fail('download', `thumbnail is ${width}x${height}; the longest side must be at most ${ARTWORK_MAX_SIDE}`, {
      wikidataId,
      fileName: entity.fileName,
    });
  }

  const file = `artists/${options.artistId}.${extensionFor(mime)}`;
  const writtenFile = path.join(options.into, file);
  mkdirSync(path.dirname(writtenFile), { recursive: true });
  writeFileSync(writtenFile, bytes);

  const notes = [
    searchNote ?? `Wikidata ${wikidataId}`,
    info.credit && info.credit !== author ? `Commons credit: ${info.credit}` : null,
    info.restrictions ? `Commons restrictions: ${info.restrictions}` : null,
    entity.musicbrainzId ? `MusicBrainz ${entity.musicbrainzId}` : null,
    info.licenseShortName && license.label !== info.licenseShortName ? `Commons licence: ${info.licenseShortName}` : null,
  ].filter((note): note is string => Boolean(note));

  const entry: MediaEntry = {
    subject_type: 'artist',
    subject_id: options.artistId,
    subject_name: options.artistName,
    file,
    sha256: sha256Of(bytes),
    mime,
    width,
    height,
    source: {
      kind: 'wikimedia-commons',
      url: info.filePageUrl,
      page_url: `https://www.wikidata.org/wiki/${wikidataId}`,
      retrieved_at: now().toISOString(),
      note: notes.join('; '),
    },
    license: {
      id: license.id,
      url: info.licenseUrl && /^https:\/\//.test(info.licenseUrl) ? info.licenseUrl : license.url,
      attribution: buildAttribution(author, license.label),
    },
    review: { status: 'pending', by: null, at: null, note: null },
  };
  return { ok: true, entry, wikidataId, fileName: entity.fileName, musicbrainzId: entity.musicbrainzId, writtenFile };
}
