import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MEDIA_COMMANDS, mediaFetchCommons, mediaFetchCommonsForSeed } from '../src/media/command';
import {
  buildAttribution,
  buildRequestedAttribution,
  CommonsClient,
  commonsFilePageUrl,
  DEFAULT_USER_AGENT,
  fetchCommonsCandidate,
  mapLicense,
  MUSIC_DESCRIPTION_PATTERN,
  stripHtml,
  type FetchLike,
} from '../src/media/commons';
import { readRegistry, sha256Of, writeRegistry } from '../src/media/registry';
import type { MediaEntry } from '../src/media/types';
import { tinyJpeg, tinyPng } from './media-fixtures';

const A1 = '33333333-3333-4333-8333-333333333331';
const A2 = '33333333-3333-4333-8333-333333333332';
const A3 = '33333333-3333-4333-8333-333333333333';
const A4 = '33333333-3333-4333-8333-333333333334';
const THUMB = tinyJpeg(512, 341);
const THUMB_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Four_Tet_2010.jpg/512px-Four_Tet_2010.jpg';

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** Canned Wikidata + Commons answers keyed by request parameters. */
function fakeFetch(): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const parsed = new URL(url);
    const params = parsed.searchParams;
    if (parsed.hostname === 'www.wikidata.org' && params.get('action') === 'wbsearchentities') {
      expect([params.get('language'), params.get('type'), params.get('format'), params.get('limit')]).toEqual(['en', 'item', 'json', '5']);
      const search = params.get('search');
      if (search === 'Four Tet') {
        return json({ search: [{ id: 'Q7', label: 'Four Tet', description: 'album' }, { id: 'Q1', label: 'Four Tet', description: 'British electronic musician' }] });
      }
      if (search === 'NC Band') {
        return json({ search: [{ id: 'Q3', label: 'NC Band', description: 'rock band' }] });
      }
      if (search === 'Imageless') {
        return json({ search: [{ id: 'Q2', label: 'Imageless', description: 'DJ and producer' }] });
      }
      if (search === 'Own Work Band') {
        return json({ search: [{ id: 'Q5', label: 'Own Work Band', description: 'indie band' }] });
      }
      if (search === 'Nobody') {
        return json({ search: [{ id: 'Q9', label: 'Nobody', description: 'village in Poland' }, { id: 'Q10', label: 'Nobody' }] });
      }
      return json({ search: [] });
    }
    if (parsed.hostname === 'www.wikidata.org' && params.get('action') === 'wbgetentities') {
      expect(params.get('props')).toBe('claims|sitelinks');
      const id = params.get('ids');
      const entities: Record<string, unknown> = {
        Q1: { claims: { P18: [{ rank: 'normal', mainsnak: { datavalue: { value: 'Four Tet 2010.jpg' } } }], P434: [{ mainsnak: { datavalue: { value: 'abc-mbid' } } }] } },
        Q2: { claims: { P434: [{ mainsnak: { datavalue: { value: 'x' } } }] } },
        Q3: { claims: { P18: [{ mainsnak: { datavalue: { value: 'NC photo.jpg' } } }] } },
        Q4: { claims: { P18: [{ mainsnak: { datavalue: { value: 'PD photo.png' } } }] } },
        Q5: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Own work photo.jpg' } } }] } },
        Q12: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Credit line photo.jpg' } } }] } },
        Q13: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Long credit photo.jpg' } } }] } },
        Q14: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Ported photo.jpg' } } }] } },
      };
      return json({ entities: { [id as string]: entities[id as string] ?? { id, missing: '' } } });
    }
    if (parsed.hostname === 'commons.wikimedia.org') {
      expect([params.get('prop'), params.get('iiprop'), params.get('iiurlwidth')]).toEqual(['imageinfo', 'url|size|mime|extmetadata', '512']);
      const title = params.get('titles');
      if (title === 'File:Four Tet 2010.jpg') {
        return json({
          query: {
            pages: {
              '123': {
                imageinfo: [
                  {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Four_Tet_2010.jpg',
                    thumburl: THUMB_URL,
                    thumbwidth: 512,
                    thumbheight: 341,
                    size: 2_345_678,
                    mime: 'image/jpeg',
                    extmetadata: {
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                      License: { value: 'cc-by-sa-4.0' },
                      LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
                      Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane" title="User:Jane">Jane &amp; Co</a>' },
                      Credit: { value: '<span class="int-own-work">Own work</span>' },
                      AttributionRequired: { value: 'true' },
                      Restrictions: { value: 'personality' },
                    },
                  },
                ],
              },
            },
          },
        });
      }
      if (title === 'File:NC photo.jpg') {
        return json({
          query: {
            pages: {
              '9': {
                imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/512px-NC_photo.jpg', extmetadata: { LicenseShortName: { value: 'CC BY-NC-SA 2.0' }, Artist: { value: 'Someone' } } }],
              },
            },
          },
        });
      }
      if (title === 'File:PD photo.png') {
        // No Artist, only a Credit (the source): fine for public domain, nothing to attribute.
        return json({
          query: {
            pages: {
              '10': {
                imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/512px-PD_photo.png', extmetadata: { LicenseShortName: { value: 'Public domain' }, Credit: { value: '<span class="int-own-work">Own work</span>' } } }],
              },
            },
          },
        });
      }
      if (title === 'File:Own work photo.jpg') {
        // A CC BY-SA file whose uploader filled in the source but not the author.
        return json({
          query: {
            pages: {
              '11': {
                imageinfo: [{
                  thumburl: 'https://upload.wikimedia.org/x/512px-Own_work_photo.jpg',
                  extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, License: { value: 'cc-by-sa-4.0' }, Credit: { value: '<span class="int-own-work">Own work</span>' }, AttributionRequired: { value: 'true' } },
                }],
              },
            },
          },
        });
      }
      const imageinfoOnly = (extmetadata: Record<string, { value: string }>) =>
        json({ query: { pages: { '12': { imageinfo: [{ thumburl: `https://upload.wikimedia.org/x/512px-${(title ?? '').slice(5).replace(/ /g, '_')}`, extmetadata }] } } } });
      if (title === 'File:Credit line photo.jpg') {
        // The licence template's attribution parameter: the author's own credit line.
        return imageinfoOnly({
          LicenseShortName: { value: 'CC BY-SA 3.0' },
          License: { value: 'cc-by-sa-3.0' },
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:JD">JD</a>' },
          Attribution: { value: 'Photo by <b>Jane Doe</b> / janedoe.com' },
          AttributionRequired: { value: 'true' },
        });
      }
      if (title === 'File:Long credit photo.jpg') {
        return imageinfoOnly({ LicenseShortName: { value: 'CC BY 4.0' }, License: { value: 'cc-by-4.0' }, Attribution: { value: `Jane Doe ${'x'.repeat(280)}` } });
      }
      if (title === 'File:Ported photo.jpg') {
        return imageinfoOnly({ LicenseShortName: { value: 'CC BY-SA 3.0 de' }, License: { value: 'cc-by-sa-3.0-de' }, Artist: { value: 'Someone' } });
      }
      return json({ query: { pages: { '-1': { missing: '' } } } });
    }
    if (parsed.hostname === 'upload.wikimedia.org') {
      const bytes = url.endsWith('.png') ? tinyPng(300, 200) : THUMB;
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'festie-commons-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function client(fetch: FetchLike, extra: { sleeps?: number[]; minIntervalMs?: number } = {}): CommonsClient {
  let clock = 0;
  return new CommonsClient({
    fetch,
    minIntervalMs: extra.minIntervalMs ?? 0,
    now: () => clock,
    sleep: async (ms) => {
      extra.sleeps?.push(ms);
      clock += ms;
    },
  });
}

describe('licence mapping and attribution', () => {
  it('maps Commons licences to registry ids and refuses NC, ND and unknown ones', () => {
    expect(mapLicense('CC BY-SA 4.0', 'cc-by-sa-4.0')).toEqual({ ok: true, id: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', label: 'CC BY-SA 4.0' });
    expect(mapLicense('CC BY 2.0', null)).toMatchObject({ ok: true, id: 'CC-BY-2.0', url: 'https://creativecommons.org/licenses/by/2.0/' });
    expect(mapLicense('CC BY-SA 3.0', 'cc-by-sa-3.0')).toMatchObject({ ok: true, id: 'CC-BY-SA-3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' });
    expect(mapLicense(null, 'cc-by-sa-3.0-migrated')).toMatchObject({ ok: true, id: 'CC-BY-SA-3.0' });
    // Country versions would be linked to the international deed in the app: refused.
    expect(mapLicense('CC BY-SA 3.0 de', 'cc-by-sa-3.0-de')).toEqual({
      ok: false,
      reason: 'CC BY-SA 3.0 de is a country version of a CC licence; only international (unported) versions are accepted',
    });
    expect(mapLicense(null, 'cc-by-2.0-fr')).toMatchObject({ ok: false, reason: expect.stringContaining('country version') });
    expect(mapLicense('CC BY-SA 3.0 IGO', null)).toMatchObject({ ok: false, reason: expect.stringContaining('country version') });
    expect(mapLicense('CC0', 'cc0')).toMatchObject({ ok: true, id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' });
    expect(mapLicense('Public domain', 'pd')).toMatchObject({ ok: true, id: 'public-domain', url: null });
    expect(mapLicense(null, 'PD-USGov')).toMatchObject({ ok: true, id: 'public-domain' });
    expect(mapLicense('CC BY-NC-SA 2.0', null)).toMatchObject({ ok: false, reason: 'CC BY-NC-SA 2.0 is non-commercial (NC); Festie is a commercial app' });
    expect(mapLicense('CC BY-ND 4.0', null)).toMatchObject({ ok: false, reason: expect.stringContaining('forbids derivatives (ND)') });
    expect(mapLicense('CC BY 1.0', null)).toMatchObject({ ok: false, reason: 'CC BY 1.0 is not in the allowed licence list' });
    expect(mapLicense('GFDL', 'gfdl')).toMatchObject({ ok: false, reason: expect.stringContaining('unrecognised licence "GFDL"') });
    expect(mapLicense(null, null)).toMatchObject({ ok: false, reason: 'no licence information on the Commons file page' });
  });

  it('strips HTML from the author and keeps the credit within 300 characters', () => {
    expect(stripHtml('<a href="x" title="y">Jane &amp; Co</a><br/>  &#169; 2020')).toBe('Jane & Co © 2020');
    expect(buildAttribution('Jane Doe', 'CC BY-SA 4.0')).toBe('Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons');
    expect(buildAttribution(null, 'CC0')).toBe('Photo: CC0, via Wikimedia Commons');
    const long = buildAttribution('x'.repeat(400), 'CC BY 4.0');
    expect(long.length).toBe(300);
    expect(long.endsWith('…, CC BY 4.0, via Wikimedia Commons')).toBe(true);
    expect(commonsFilePageUrl('Four Tet 2010.jpg')).toBe('https://commons.wikimedia.org/wiki/File:Four_Tet_2010.jpg');
    // A credit line the author asked for is kept word for word, never shortened.
    expect(buildRequestedAttribution('Jane Doe / janedoe.com', 'CC BY-SA 3.0')).toBe('Photo: Jane Doe / janedoe.com, CC BY-SA 3.0, via Wikimedia Commons');
    expect(buildRequestedAttribution(' Photo by Jane Doe ', 'CC BY 4.0')).toBe('Photo by Jane Doe, CC BY 4.0, via Wikimedia Commons');
    expect(buildRequestedAttribution('© Jane Doe, CC-BY-SA-4.0', 'CC BY-SA 4.0')).toBe('© Jane Doe, CC-BY-SA-4.0, via Wikimedia Commons');
    expect(buildRequestedAttribution('x'.repeat(290), 'CC BY 4.0')).toBeNull();
    expect(buildRequestedAttribution('   ', 'CC BY 4.0')).toBeNull();
    expect(MUSIC_DESCRIPTION_PATTERN.test('American rapper and record producer')).toBe(true);
    expect(MUSIC_DESCRIPTION_PATTERN.test('village in Poland')).toBe(false);
  });
});

describe('fetchCommonsCandidate', () => {
  it('finds the artist, checks the licence, downloads the thumbnail and returns a pending entry', async () => {
    const { fetch, calls } = fakeFetch();
    const into = tempDir();
    const sleeps: number[] = [];
    const result = await fetchCommonsCandidate({
      artistName: 'Four Tet',
      artistId: A1,
      into,
      client: client(fetch, { sleeps, minIntervalMs: 1000 }),
      now: () => new Date('2026-10-12T12:00:00Z'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.wikidataId).toBe('Q1');
    expect(result.fileName).toBe('Four Tet 2010.jpg');
    expect(result.musicbrainzId).toBe('abc-mbid');
    expect(result.writtenFile).toBe(path.join(into, 'artists', `${A1}.jpg`));
    expect(readFileSync(result.writtenFile).equals(THUMB)).toBe(true);
    expect(result.entry).toEqual({
      subject_type: 'artist',
      subject_id: A1,
      subject_name: 'Four Tet',
      file: `artists/${A1}.jpg`,
      sha256: sha256Of(THUMB),
      mime: 'image/jpeg',
      width: 512,
      height: 341,
      source: {
        kind: 'wikimedia-commons',
        url: 'https://commons.wikimedia.org/wiki/File:Four_Tet_2010.jpg',
        page_url: 'https://www.wikidata.org/wiki/Q1',
        retrieved_at: '2026-10-12T12:00:00.000Z',
        note: 'Wikidata Q1 "Four Tet" (British electronic musician); Commons credit: Own work; Commons restrictions: personality; MusicBrainz abc-mbid',
      },
      license: {
        id: 'CC-BY-SA-4.0',
        url: 'https://creativecommons.org/licenses/by-sa/4.0',
        attribution: 'Photo: Jane & Co, CC BY-SA 4.0, via Wikimedia Commons',
      },
      review: { status: 'pending', by: null, at: null, note: null },
    });
    // Four calls (search, entity, imageinfo, thumbnail), each with the agent header, one second apart.
    expect(calls.map((call) => new URL(call.url).hostname)).toEqual(['www.wikidata.org', 'www.wikidata.org', 'commons.wikimedia.org', 'upload.wikimedia.org']);
    expect(calls.every((call) => call.headers['User-Agent'] === DEFAULT_USER_AGENT)).toBe(true);
    expect(sleeps).toEqual([1000, 1000, 1000]);
  });

  it('refuses a non-commercial licence and writes nothing', async () => {
    const { fetch } = fakeFetch();
    const into = tempDir();
    const result = await fetchCommonsCandidate({ artistName: 'NC Band', artistId: A2, into, client: client(fetch) });
    expect(result).toEqual({
      ok: false,
      stage: 'license',
      reason: 'CC BY-NC-SA 2.0 is non-commercial (NC); Festie is a commercial app',
      wikidataId: 'Q3',
      fileName: 'NC photo.jpg',
      license: 'CC BY-NC-SA 2.0',
    });
    expect(existsSync(path.join(into, 'artists'))).toBe(false);
  });

  it('reports an item without an image (P18) and a search without a music act', async () => {
    const { fetch } = fakeFetch();
    const into = tempDir();
    expect(await fetchCommonsCandidate({ artistName: 'Imageless', artistId: A3, into, client: client(fetch) })).toMatchObject({
      ok: false,
      stage: 'entity',
      reason: 'Wikidata Q2 has no image (P18)',
      wikidataId: 'Q2',
    });
    expect(await fetchCommonsCandidate({ artistName: 'Nobody', artistId: A3, into, client: client(fetch) })).toMatchObject({
      ok: false,
      stage: 'search',
      reason: 'no Wikidata hit described as a music act; saw Q9 "Nobody" (village in Poland), Q10 "Nobody" (no description)',
    });
    expect(await fetchCommonsCandidate({ artistName: 'Unknown Act', artistId: A3, into, client: client(fetch) })).toMatchObject({
      ok: false,
      stage: 'search',
      reason: 'no Wikidata item found',
    });
    // An explicit Wikidata id skips the search; a missing entity is an error (not silently a miss).
    expect(await fetchCommonsCandidate({ artistName: 'X', artistId: A3, wikidataId: 'nope', into, client: client(fetch) })).toMatchObject({ ok: false, stage: 'entity' });
    await expect(fetchCommonsCandidate({ artistName: 'X', artistId: A3, wikidataId: 'Q404', into, client: client(fetch) })).rejects.toThrow('Wikidata entity Q404 not found');
  });

  it('accepts a public-domain PNG and records the Commons label', async () => {
    const { fetch } = fakeFetch();
    const into = tempDir();
    const result = await fetchCommonsCandidate({ artistName: 'PD Act', artistId: A4, wikidataId: 'Q4', into, client: client(fetch) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry).toMatchObject({ file: `artists/${A4}.png`, mime: 'image/png', width: 300, height: 200, license: { id: 'public-domain', url: null, attribution: 'Photo: Public domain, via Wikimedia Commons' } });
      // The Credit ("Own work") is the source, not an author: noted for the reviewer, never credited.
      expect(result.entry.license.attribution).not.toContain('Own work');
      expect(result.entry.source.note).toBe('Wikidata Q4; Commons credit: Own work');
    }
  });

  it('refuses a CC BY-SA file whose only "author" would be the Credit source ("Own work")', async () => {
    const { fetch } = fakeFetch();
    const into = tempDir();
    const result = await fetchCommonsCandidate({ artistName: 'Own Work Band', artistId: A2, into, client: client(fetch) });
    expect(result).toEqual({
      ok: false,
      stage: 'license',
      reason: 'CC BY-SA 4.0 requires attribution but Commons lists no author',
      wikidataId: 'Q5',
      fileName: 'Own work photo.jpg',
      license: 'CC BY-SA 4.0',
    });
    expect(existsSync(path.join(into, 'artists'))).toBe(false);
  });

  it("credits the author's requested credit line word for word and notes the Artist field", async () => {
    const { fetch } = fakeFetch();
    const into = tempDir();
    const result = await fetchCommonsCandidate({ artistName: 'Credit Line Band', artistId: A2, wikidataId: 'Q12', into, client: client(fetch) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.license).toEqual({
        id: 'CC-BY-SA-3.0',
        url: 'https://creativecommons.org/licenses/by-sa/3.0/',
        attribution: 'Photo by Jane Doe / janedoe.com, CC BY-SA 3.0, via Wikimedia Commons',
      });
      expect(result.entry.source.note).toBe('Wikidata Q12; Commons requested credit: Photo by Jane Doe / janedoe.com; Commons author: JD');
    }
  });

  it('refuses a requested credit line that does not fit, and a country version of a licence', async () => {
    const { fetch } = fakeFetch();
    const into = tempDir();
    expect(await fetchCommonsCandidate({ artistName: 'Long Credit', artistId: A3, wikidataId: 'Q13', into, client: client(fetch) })).toEqual({
      ok: false,
      stage: 'license',
      reason: "the credit line the author asks for is too long for the app's 300-character credit; write the credit by hand or leave the photo out",
      wikidataId: 'Q13',
      fileName: 'Long credit photo.jpg',
      license: 'CC BY 4.0',
    });
    expect(await fetchCommonsCandidate({ artistName: 'Ported', artistId: A4, wikidataId: 'Q14', into, client: client(fetch) })).toMatchObject({
      ok: false,
      stage: 'license',
      reason: 'CC BY-SA 3.0 de is a country version of a CC licence; only international (unported) versions are accepted',
      license: 'CC BY-SA 3.0 de',
    });
    expect(existsSync(path.join(into, 'artists'))).toBe(false);
  });

  it('fails loudly on HTTP errors and insists on a fetch implementation', async () => {
    const failing: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(fetchCommonsCandidate({ artistName: 'Four Tet', artistId: A1, into: tempDir(), client: client(failing) })).rejects.toThrow('failed with HTTP 429');
    const original = globalThis.fetch;
    // @ts-expect-error simulate an old runtime
    globalThis.fetch = undefined;
    try {
      expect(() => new CommonsClient()).toThrow('No fetch implementation');
    } finally {
      globalThis.fetch = original;
    }
  });
});

function pendingEntry(id: string, name: string, file: string, status: MediaEntry['review']['status'] = 'pending'): MediaEntry {
  return {
    subject_type: 'artist',
    subject_id: id,
    subject_name: name,
    file,
    sha256: 'a'.repeat(64),
    mime: file.endsWith('.png') ? 'image/png' : 'image/jpeg',
    width: 1,
    height: 1,
    source: { kind: 'other', url: null, retrieved_at: '2026-10-01T00:00:00Z' },
    license: { id: 'CC0-1.0', url: null, attribution: null },
    review: { status, by: status === 'pending' ? null : 'kev', at: status === 'pending' ? null : '2026-10-01T00:00:00Z' },
  };
}

describe('media:fetch-commons command', () => {
  it('writes the pending entry into the registry, replacing older entries and their files', async () => {
    const { fetch } = fakeFetch();
    const into = tempDir();
    const registryFile = path.join(into, 'registry.json');
    mkdirSync(path.join(into, 'artists'));
    writeFileSync(path.join(into, 'artists', `${A1}.png`), 'old');
    writeRegistry({ version: 1, entries: [pendingEntry(A2, 'Other', `artists/${A2}.jpg`), pendingEntry(A1, 'Four Tet', `artists/${A1}.png`, 'approved')] }, registryFile);
    const lines: string[] = [];

    const result = await mediaFetchCommons({ artist: 'Four Tet', artistId: A1, into, client: client(fetch), log: (line) => lines.push(line) });
    expect(result.result.ok).toBe(true);
    expect(result.registryFile).toBe(registryFile);
    expect(result.removedFiles).toEqual([`artists/${A1}.png`]);
    expect(existsSync(path.join(into, 'artists', `${A1}.png`))).toBe(false);
    expect(existsSync(path.join(into, 'artists', `${A1}.jpg`))).toBe(true);
    const registry = readRegistry(registryFile);
    expect(registry.entries.map((entry) => [entry.subject_id, entry.file, entry.review.status])).toEqual([
      [A2, `artists/${A2}.jpg`, 'pending'],
      [A1, `artists/${A1}.jpg`, 'pending'],
    ]);
    expect(lines[0]).toContain('WARNING replaced an APPROVED entry for Four Tet');
    expect(lines[1]).toMatch(/^HIT {2}Four Tet: artists\/.*\.jpg CC-BY-SA-4\.0 \(512x341\) from https:\/\/commons\.wikimedia\.org\/wiki\/File:Four_Tet_2010\.jpg — pending review in /);

    const miss = await mediaFetchCommons({ artist: 'NC Band', artistId: A2, into, client: client(fetch), log: (line) => lines.push(line) });
    expect(miss.result.ok).toBe(false);
    expect(lines.at(-1)).toBe('MISS NC Band: CC BY-NC-SA 2.0 is non-commercial (NC); Festie is a commercial app (File:NC photo.jpg)');
    expect(readRegistry(registryFile).entries).toHaveLength(2);
  });

  it('creates the registry when it does not exist and validates its arguments', async () => {
    const { fetch } = fakeFetch();
    const into = path.join(tempDir(), 'media');
    await mediaFetchCommons({ artist: 'Four Tet', artistId: A1, wikidataId: 'Q1', into, client: client(fetch) });
    expect(readRegistry(path.join(into, 'registry.json')).entries).toHaveLength(1);
    await expect(mediaFetchCommons({ artist: '', artistId: A1, into, client: client(fetch) })).rejects.toThrow('--artist must be the artist name');
    await expect(mediaFetchCommons({ artist: 'X', artistId: 'abc', into, client: client(fetch) })).rejects.toThrow('--artist-id must be the artist');
    await expect(mediaFetchCommons({ artist: 'X', artistId: A1, wikidataId: '42', into, client: client(fetch) })).rejects.toThrow('--wikidata must be a Wikidata item id');
  });

  it('parses the CLI forms', async () => {
    await expect(MEDIA_COMMANDS['media:fetch-commons'](['--artist', 'X'], () => {})).rejects.toThrow('Usage: media:fetch-commons --artist <name> --artist-id <uuid>');
    await expect(MEDIA_COMMANDS['media:fetch-commons'](['--seed', 'x.json', '--artist', 'X'], () => {})).rejects.toThrow('Use either --seed or --artist/--artist-id.');
    await expect(MEDIA_COMMANDS['media:fetch-commons'](['--seed', 'x.json', '--limit', '0'], () => {})).rejects.toThrow('--limit must be a positive integer');
    await expect(MEDIA_COMMANDS['media:fetch-commons'](['--bogus'], () => {})).rejects.toThrow("Unknown option '--bogus'");
  });
});

describe('mediaFetchCommonsForSeed', () => {
  it('fetches every artist without an entry and summarises hits, rejections, misses and skips', async () => {
    const { fetch, calls } = fakeFetch();
    const into = tempDir();
    const registryFile = path.join(into, 'registry.json');
    writeRegistry({ version: 1, entries: [pendingEntry(A4, 'Already Here', `artists/${A4}.jpg`, 'rejected')] }, registryFile);
    const seedFile = path.join(tempDir(), 'fest.json');
    writeFileSync(
      seedFile,
      JSON.stringify({
        festival: { id: '11111111-1111-4111-8111-111111111111', name: 'Fest' },
        artists: [
          { id: A1, name: 'Four Tet' },
          { id: A2, name: 'NC Band' },
          { id: A3, name: 'Imageless' },
          { id: A4, name: 'Already Here' },
        ],
      }),
    );
    const lines: string[] = [];
    const summary = await mediaFetchCommonsForSeed({ seedFile, into, client: client(fetch), log: (line) => lines.push(line) });
    expect(summary.hits).toEqual([{ artist: 'Four Tet', artistId: A1, file: `artists/${A1}.jpg`, license: 'CC-BY-SA-4.0' }]);
    expect(summary.rejected).toEqual([
      { artist: 'NC Band', artistId: A2, license: 'CC BY-NC-SA 2.0', fileName: 'NC photo.jpg', reason: 'CC BY-NC-SA 2.0 is non-commercial (NC); Festie is a commercial app' },
    ]);
    expect(summary.misses).toEqual([{ artist: 'Imageless', artistId: A3, stage: 'entity', reason: 'Wikidata Q2 has no image (P18)' }]);
    expect(summary.skipped).toEqual([{ artist: 'Already Here', artistId: A4, status: 'rejected' }]);
    expect(summary.text).toContain('4 artist(s)');
    expect(summary.text).toContain('hits      1: Four Tet (CC-BY-SA-4.0)');
    expect(summary.text).toContain('rejected  1 (licence): NC Band (CC BY-NC-SA 2.0)');
    expect(summary.text).toContain('misses    1: Imageless (entity)');
    expect(summary.text).toContain('skipped   1 already in the registry');
    expect(summary.text).toContain('Review the pending entries in');
    expect(lines.at(-1)).toBe(summary.text);
    const registry = readRegistry(registryFile);
    expect(registry.entries.map((entry) => entry.subject_id)).toEqual([A4, A1]);
    // One shared client: the whole walk is one request stream (no per-artist client).
    expect(calls.length).toBe(4 + 3 + 2);

    const limited = await mediaFetchCommonsForSeed({ seedFile, into: tempDir(), client: client(fetch), limit: 1 });
    expect(limited.hits).toHaveLength(1);
    expect(limited.rejected).toEqual([]);
    expect(limited.misses).toEqual([]);
  });

  it('keeps going when one artist fails with a network error', async () => {
    const { fetch } = fakeFetch();
    let failed = false;
    const flaky: FetchLike = async (url, init) => {
      if (url.includes('NC+Band') && !failed) {
        failed = true;
        throw new Error('ECONNRESET');
      }
      return fetch(url, init);
    };
    const seedFile = path.join(tempDir(), 'fest.json');
    writeFileSync(seedFile, JSON.stringify({ artists: [{ id: A2, name: 'NC Band' }, { id: A1, name: 'Four Tet' }] }));
    const summary = await mediaFetchCommonsForSeed({ seedFile, into: tempDir(), client: client(flaky) });
    expect(summary.misses).toEqual([{ artist: 'NC Band', artistId: A2, stage: 'search', reason: 'ECONNRESET' }]);
    expect(summary.hits.map((hit) => hit.artist)).toEqual(['Four Tet']);
  });

  it('rejects seeds without usable artists', async () => {
    const seedFile = path.join(tempDir(), 'fest.json');
    writeFileSync(seedFile, JSON.stringify({ artists: [{ id: 'x', name: 'Y' }] }));
    await expect(mediaFetchCommonsForSeed({ seedFile, into: tempDir(), client: client(fakeFetch().fetch) })).rejects.toThrow('every artist needs an id (UUID) and a name');
    await expect(mediaFetchCommonsForSeed({ seedFile: path.join(tempDir(), 'missing.json'), into: tempDir(), client: client(fakeFetch().fetch) })).rejects.toThrow('File not found');
  });
});
