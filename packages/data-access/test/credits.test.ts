import { upsertRows } from '@festival/sync-engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getLocalImageCredits } from '../src/credits';
import { setupDataAccessTest, teardownDataAccessTest } from './helpers';

function festival(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return { id, name, start_date: '2027-06-18', end_date: '2027-06-20', timezone: 'UTC', version: 1, ...overrides };
}

describe('getLocalImageCredits', () => {
  beforeEach(() => {
    setupDataAccessTest();
  });
  afterEach(teardownDataAccessTest);

  it('lists every cached artist and festival photo with its attribution, by name', async () => {
    await upsertRows('festivals', [
      festival('f1', 'Zenith Fest', {
        image_url: 'https://cdn.example/artwork/festivals/f1.jpg',
        image_credit: 'Photo: Zenith Fest press kit',
        image_license: 'press-kit-editorial',
        image_source_url: 'https://zenith.example/press',
      }),
      festival('f2', 'No Photo Fest'),
    ]);
    await upsertRows('artists', [
      {
        id: 'a1',
        name: 'beta',
        image_url: 'https://cdn.example/artwork/artists/a1.jpg',
        image_credit: 'Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons',
        image_license: 'CC-BY-SA-4.0',
        image_source_url: 'https://commons.wikimedia.org/wiki/File:Beta.jpg',
      },
      { id: 'a2', name: 'Alpha', image_url: null, genre: null },
      // Never shown by the app, so never credited.
      { id: 'a3', name: 'Gamma', image_url: '' },
      { id: 'a4', name: 'Delta', image_url: 'https://cdn.example/artwork/artists/a4.jpg', image_credit: null, image_license: 'CC0-1.0' },
    ]);

    expect(await getLocalImageCredits()).toEqual([
      {
        subject_type: 'artist',
        subject_id: 'a1',
        name: 'beta',
        image_url: 'https://cdn.example/artwork/artists/a1.jpg',
        image_credit: 'Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons',
        image_license: 'CC-BY-SA-4.0',
        image_source_url: 'https://commons.wikimedia.org/wiki/File:Beta.jpg',
      },
      {
        subject_type: 'artist',
        subject_id: 'a4',
        name: 'Delta',
        image_url: 'https://cdn.example/artwork/artists/a4.jpg',
        image_credit: null,
        image_license: 'CC0-1.0',
        image_source_url: null,
      },
      {
        subject_type: 'festival',
        subject_id: 'f1',
        name: 'Zenith Fest',
        image_url: 'https://cdn.example/artwork/festivals/f1.jpg',
        image_credit: 'Photo: Zenith Fest press kit',
        image_license: 'press-kit-editorial',
        image_source_url: 'https://zenith.example/press',
      },
    ]);
  });

  it('is empty when nothing cached has a photo', async () => {
    await upsertRows('festivals', [festival('f1', 'Fest')]);
    await upsertRows('artists', [{ id: 'a1', name: 'Artist' }]);
    expect(await getLocalImageCredits()).toEqual([]);
  });
});
