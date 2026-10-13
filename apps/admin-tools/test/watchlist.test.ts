import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addWatchlistEntry,
  formatSuggestionRanking,
  formatWatchlistTable,
  groupSuggestions,
  noSignals,
  rankWatchlist,
  readWatchlist,
  removeWatchlistEntry,
  SCOUT_THRESHOLD,
  scoreEntry,
  setWatchlistStatus,
  urgencyPoints,
  type Watchlist,
  type WatchlistEntry,
  linkWatchlistFestival,
} from '../src/watchlist/watchlist';

const TODAY = '2026-10-12';

function entry(overrides: Partial<WatchlistEntry>): WatchlistEntry {
  return {
    slug: 'fest-2027',
    name: 'Fest',
    year: 2027,
    tier: 'B',
    official_url: null,
    start_date: null,
    end_date: null,
    festival_id: null,
    status: 'watching',
    note: null,
    added_by: null,
    added_at: '2026-10-12T00:00:00Z',
    ...overrides,
  };
}

describe('watchlist scoring', () => {
  it('gives urgency only inside the 120-day window, more the closer the start', () => {
    expect(urgencyPoints(null, TODAY)).toBe(0);
    expect(urgencyPoints('2026-10-11', TODAY)).toBe(0); // past
    expect(urgencyPoints('2026-10-12', TODAY)).toBe(30);
    expect(urgencyPoints('2026-12-31', TODAY)).toBe(10);
    expect(urgencyPoints('2027-05-14', TODAY)).toBe(0); // beyond the window
  });

  it('scouts flagship events on schedule, and regional events only with demand or a near date', () => {
    const flagship = scoreEntry(entry({ tier: 'A', start_date: '2027-05-14' }), noSignals(), TODAY);
    expect(flagship.score).toBe(100);
    expect(flagship.scout).toBe(true);

    const quietRegional = scoreEntry(entry({ tier: 'B' }), noSignals(), TODAY);
    expect(quietRegional.score).toBe(50);
    expect(quietRegional.scout).toBe(false);

    const asked = scoreEntry(entry({ tier: 'B' }), { suggestions: new Map([['fest', 2]]), follows: new Map() }, TODAY);
    expect(asked.suggestions).toBe(2);
    expect(asked.score).toBe(70);
    expect(asked.scout).toBe(true);

    const soon = scoreEntry(entry({ tier: 'B', start_date: '2026-10-20' }), noSignals(), TODAY);
    expect(soon.score).toBeGreaterThanOrEqual(SCOUT_THRESHOLD);

    const tracked = scoreEntry(entry({ tier: 'C', festival_id: 'f1' }), { suggestions: new Map(), follows: new Map([['f1', 100]]) }, TODAY);
    expect(tracked.follows).toBe(100);
    expect(tracked.score).toBe(50); // follow points are capped
    expect(tracked.scout).toBe(false);
  });

  it('never scouts an entry that is already a candidate, published, passed or dropped', () => {
    for (const status of ['candidate', 'published', 'passed', 'dropped'] as const) {
      expect(scoreEntry(entry({ tier: 'A', status }), noSignals(), TODAY).scout).toBe(false);
    }
  });

  it('keeps scouting a festival published with its lineup only, until its set times are in', () => {
    expect(scoreEntry(entry({ tier: 'A', status: 'awaiting_times' }), noSignals(), TODAY).scout).toBe(true);
    expect(scoreEntry(entry({ tier: 'B', status: 'awaiting_times' }), noSignals(), TODAY).scout).toBe(false);
  });

  it('ranks by score, then soonest start, then name', () => {
    const list: Watchlist = {
      version: 1,
      festivals: [
        entry({ slug: 'b', name: 'Bravo', tier: 'A', start_date: '2027-06-01' }),
        entry({ slug: 'a', name: 'Alpha', tier: 'A', start_date: '2027-06-01' }),
        entry({ slug: 'c', name: 'Charlie', tier: 'A', start_date: '2026-11-01' }),
        entry({ slug: 'd', name: 'Delta', tier: 'B' }),
      ],
    };
    expect(rankWatchlist(list, noSignals(), TODAY).map((item) => item.slug)).toEqual(['c', 'a', 'b', 'd']);
    expect(formatWatchlistTable(rankWatchlist(list, noSignals(), TODAY), { signalsLoaded: false })).toContain('Offline');
  });
});

describe('watchlist file', () => {
  it('adds, replaces, changes status and removes entries, keeping the file valid', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'festie-watchlist-'));
    expect(readWatchlist(root).festivals).toEqual([]);

    const added = addWatchlistEntry({ name: 'EDC Las Vegas', year: 2027, tier: 'A', officialUrl: 'https://lasvegas.edc.com', startDate: '2027-05-14', now: '2026-10-12T00:00:00Z', root });
    expect(added.replaced).toBe(false);
    expect(added.entry.slug).toBe('edc-las-vegas-2027');

    const replaced = addWatchlistEntry({ slug: 'edc-las-vegas-2027', name: 'EDC Las Vegas', tier: 'B', root });
    expect(replaced.replaced).toBe(true);
    expect(replaced.entry.official_url).toBe('https://lasvegas.edc.com'); // kept
    expect(replaced.entry.added_at).toBe('2026-10-12T00:00:00Z');

    expect(setWatchlistStatus('edc-las-vegas-2027', 'candidate', root).status).toBe('candidate');
    expect(() => setWatchlistStatus('nope', 'dropped', root)).toThrow(/not on the watchlist/);
    expect(() => addWatchlistEntry({ name: 'X', tier: 'A', officialUrl: 'http://x.example', root })).toThrow(/https/);
    expect(() => addWatchlistEntry({ name: 'X', tier: 'A', startDate: '12/01/2027', root })).toThrow(/YYYY-MM-DD/);

    // candidate:promote records the festival id (golden slug first, then the candidate's own slug).
    expect(linkWatchlistFestival(['edc-las-vegas-2027-times-2027-05-10', 'edc-las-vegas-2027'], 'f-edc', root)).toBe('edc-las-vegas-2027');
    expect(readWatchlist(root).festivals[0].festival_id).toBe('f-edc');
    expect(linkWatchlistFestival(['unknown-fest'], 'f-x', root)).toBeNull();

    const saved = JSON.parse(readFileSync(path.join(root, 'golden', 'watchlist.json'), 'utf8')) as Watchlist;
    expect(saved.festivals).toHaveLength(1);
    expect(removeWatchlistEntry('edc-las-vegas-2027', root)).toBe(true);
    expect(removeWatchlistEntry('edc-las-vegas-2027', root)).toBe(false);
  });

  it('reads the repository watchlist', () => {
    const list = readWatchlist();
    expect(list.festivals.map((item) => item.slug)).toContain('edc-las-vegas-2027');
    expect(list.festivals.every((item) => ['A', 'B', 'C'].includes(item.tier))).toBe(true);
  });
});

describe('suggestion ranking', () => {
  it('groups by normalized name, ignores rejected rows and marks watchlist/golden matches', () => {
    const groups = groupSuggestions(
      [
        { name: 'EDC Las Vegas', url: 'https://lasvegas.edc.com', created_at: '2026-10-01T00:00:00Z', status: 'new' },
        { name: '  edc las vegas ', url: null, created_at: '2026-10-05T00:00:00Z', status: 'accepted' },
        { name: 'Tomorrowland', url: null, created_at: '2026-10-03T00:00:00Z', status: 'new' },
        { name: 'Spam Fest', url: null, created_at: '2026-10-04T00:00:00Z', status: 'rejected' },
        { name: 'Head Trip', url: null, created_at: '2026-10-02T00:00:00Z', status: 'new' },
      ],
      { version: 1, festivals: [entry({ slug: 'edc-las-vegas-2027', name: 'EDC Las Vegas', tier: 'A' })] },
      new Map([['head trip', 'head-trip-2026']]),
    );
    expect(groups.map((group) => [group.name, group.count, group.on_watchlist, group.in_golden])).toEqual([
      ['EDC Las Vegas', 2, 'edc-las-vegas-2027', null],
      ['Tomorrowland', 1, null, null],
      ['Head Trip', 1, null, 'head-trip-2026'],
    ]);
    expect(groups[0].last_at).toBe('2026-10-05T00:00:00Z');
    expect(formatSuggestionRanking(groups)).toContain('edc-las-vegas-2027');
    expect(formatSuggestionRanking([])).toBe('No suggestions yet.');
  });
});
