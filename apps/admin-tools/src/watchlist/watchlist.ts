/**
 * The watchlist decides which festivals the scout agent may work on. Agents never go looking for
 * every event; they take the top of this list or an explicit admin request
 * (docs/agents/festival-pipeline.md §2 "Intake" and §5).
 *
 *   seed-data/golden/watchlist.json   { version: 1, festivals: [WatchlistEntry] }
 *
 * Priority is a transparent score: the tier the admin assigned (flagship events such as EDC Las Vegas,
 * Coachella, Lollapalooza, Ultra, Head Trip), how many users asked for it in the app, how many follow
 * it already (when it is in the catalog), and how soon it starts. Only entries at or above
 * `SCOUT_THRESHOLD` are scouted on a schedule; an admin can always ask for any entry by slug.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../env';
import { isSlug, slugify } from '../candidates/slug';
import { normalizeName, readGoldenIndex, seedDataRoot } from '../candidates/store';

export const WATCHLIST_FILE = 'golden/watchlist.json';

export const TIERS = ['A', 'B', 'C'] as const;
/** A: flagship (scouted as soon as a lineup is out). B: regional major. C: tracked, scouted only on request. */
export type Tier = (typeof TIERS)[number];

/**
 * `watching` → `candidate` (a bundle awaits review) → `published`. A festival published with its
 * lineup but no set times (festival-data.md §4.2) is `awaiting_times`: scouted again on schedule, like
 * `watching`, until a seed with set times moves it to `published`. `passed` and `dropped` leave scheduling.
 */
export const WATCH_STATUSES = ['watching', 'candidate', 'awaiting_times', 'published', 'passed', 'dropped'] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];
/** Statuses a scheduled run may scout (given the score). */
export const SCOUTABLE_STATUSES: ReadonlySet<WatchStatus> = new Set<WatchStatus>(['watching', 'awaiting_times']);

export interface WatchlistEntry {
  slug: string;
  name: string;
  /** Edition year as the organizer bills it (Countdown NYE 2026 runs into 2027). */
  year: number | null;
  tier: Tier;
  official_url: string | null;
  /** Festival-local calendar dates when known. */
  start_date: string | null;
  end_date: string | null;
  /** `festivals.id` once the festival is in the catalog (lets follows count). */
  festival_id: string | null;
  status: WatchStatus;
  note: string | null;
  added_by: string | null;
  added_at: string;
}

export interface Watchlist {
  version: 1;
  festivals: WatchlistEntry[];
}

/** Score weights (documented in the pipeline guide; change both together). */
export const TIER_POINTS: Readonly<Record<Tier, number>> = { A: 100, B: 50, C: 0 };
export const SUGGESTION_POINTS = 10;
export const SUGGESTION_CAP = 50;
export const FOLLOW_POINTS = 5;
export const FOLLOW_CAP = 50;
export const URGENCY_WINDOW_DAYS = 120;
export const URGENCY_MAX = 30;
/** Scheduled runs scout entries at or above this score; a tier-B event needs user demand or a near date. */
export const SCOUT_THRESHOLD = 60;

export interface Signals {
  /** Suggestion count by normalized festival name. */
  suggestions: Map<string, number>;
  /** Follow count by festival id. */
  follows: Map<string, number>;
}

export interface ScoredEntry extends WatchlistEntry {
  suggestions: number;
  follows: number;
  urgency: number;
  score: number;
  /** True when a scheduled run may scout it (status watching or awaiting_times, and score ≥ threshold). */
  scout: boolean;
}

export function watchlistPath(root?: string): string {
  return path.join(seedDataRoot(root), WATCHLIST_FILE);
}

export function emptyWatchlist(): Watchlist {
  return { version: 1, festivals: [] };
}

export function readWatchlist(root?: string): Watchlist {
  const filePath = watchlistPath(root);
  if (!existsSync(filePath)) {
    return emptyWatchlist();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { festivals?: unknown }).festivals)) {
    throw new Error(`${filePath} must be {"version": 1, "festivals": [...]}`);
  }
  const festivals = (raw as { festivals: unknown[] }).festivals.map((entry, index) => normalizeEntry(entry, `${filePath} festivals[${index}]`));
  return { version: 1, festivals };
}

export function writeWatchlist(watchlist: Watchlist, root?: string): string {
  const filePath = watchlistPath(root);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(watchlist, null, 2)}\n`, 'utf8');
  return filePath;
}

function normalizeEntry(raw: unknown, where: string): WatchlistEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${where} must be an object`);
  }
  const entry = raw as Record<string, unknown>;
  if (typeof entry.slug !== 'string' || !isSlug(entry.slug)) {
    throw new Error(`${where}.slug must match ^[a-z0-9]+(-[a-z0-9]+)*$`);
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    throw new Error(`${where}.name is required`);
  }
  if (!TIERS.includes(entry.tier as Tier)) {
    throw new Error(`${where}.tier must be one of ${TIERS.join(', ')}`);
  }
  const status = (WATCH_STATUSES as readonly string[]).includes(entry.status as string) ? (entry.status as WatchStatus) : 'watching';
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
  const date = (value: unknown, field: string): string | null => {
    const v = text(value);
    if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new Error(`${where}.${field} must be YYYY-MM-DD`);
    }
    return v;
  };
  return {
    slug: entry.slug,
    name: entry.name.trim(),
    year: typeof entry.year === 'number' && Number.isInteger(entry.year) ? entry.year : null,
    tier: entry.tier as Tier,
    official_url: text(entry.official_url),
    start_date: date(entry.start_date, 'start_date'),
    end_date: date(entry.end_date, 'end_date'),
    festival_id: text(entry.festival_id),
    status,
    note: text(entry.note),
    added_by: text(entry.added_by),
    added_at: typeof entry.added_at === 'string' ? entry.added_at : '',
  };
}

// Scoring ------------------------------------------------------------------------------------------

/** 0–30: a festival within the window scores more the closer it is; past or unknown dates score 0. */
export function urgencyPoints(startDate: string | null, today: string): number {
  if (!startDate) {
    return 0;
  }
  const days = Math.round((Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0 || days > URGENCY_WINDOW_DAYS) {
    return 0;
  }
  return Math.round(URGENCY_MAX * (1 - days / URGENCY_WINDOW_DAYS));
}

export function scoreEntry(entry: WatchlistEntry, signals: Signals, today: string): ScoredEntry {
  const suggestions = signals.suggestions.get(normalizeName(entry.name)) ?? 0;
  const follows = entry.festival_id ? signals.follows.get(entry.festival_id) ?? 0 : 0;
  const urgency = urgencyPoints(entry.start_date, today);
  const score =
    TIER_POINTS[entry.tier] +
    Math.min(SUGGESTION_CAP, suggestions * SUGGESTION_POINTS) +
    Math.min(FOLLOW_CAP, follows * FOLLOW_POINTS) +
    urgency;
  return { ...entry, suggestions, follows, urgency, score, scout: SCOUTABLE_STATUSES.has(entry.status) && score >= SCOUT_THRESHOLD };
}

/** Highest score first; ties by soonest start, then name. */
export function rankWatchlist(watchlist: Watchlist, signals: Signals, today: string): ScoredEntry[] {
  return watchlist.festivals
    .map((entry) => scoreEntry(entry, signals, today))
    .sort((a, b) => b.score - a.score || (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999') || a.name.localeCompare(b.name));
}

export function noSignals(): Signals {
  return { suggestions: new Map(), follows: new Map() };
}

/** User demand from the database: suggestion counts by name and follow counts by festival id (service role). */
export async function loadSignals(client: SupabaseClient): Promise<Signals> {
  const signals = noSignals();
  const suggestions = (check(
    await client.from('festival_suggestions').select('name, status').neq('status', 'rejected').limit(10_000),
    'Reading suggestions',
  ) ?? []) as Array<{ name: string; status: string }>;
  for (const row of suggestions) {
    const key = normalizeName(row.name);
    signals.suggestions.set(key, (signals.suggestions.get(key) ?? 0) + 1);
  }
  const follows = (check(await client.from('user_festivals').select('festival_id').limit(100_000), 'Reading follows') ?? []) as Array<{
    festival_id: string;
  }>;
  for (const row of follows) {
    signals.follows.set(row.festival_id, (signals.follows.get(row.festival_id) ?? 0) + 1);
  }
  return signals;
}

/** Suggestion demand grouped by festival name, most requested first (for `suggestions:ranking`). */
export interface SuggestionGroup {
  name: string;
  count: number;
  urls: string[];
  first_at: string;
  last_at: string;
  on_watchlist: string | null;
  in_golden: string | null;
}

export function groupSuggestions(
  rows: Array<{ name: string; url: string | null; created_at: string; status: string }>,
  watchlist: Watchlist,
  goldenNames: Map<string, string>,
): SuggestionGroup[] {
  const watch = new Map(watchlist.festivals.map((entry) => [normalizeName(entry.name), entry.slug]));
  const groups = new Map<string, SuggestionGroup>();
  for (const row of rows) {
    if (row.status === 'rejected') continue;
    const key = normalizeName(row.name);
    const group = groups.get(key) ?? {
      name: row.name.trim(),
      count: 0,
      urls: [],
      first_at: row.created_at,
      last_at: row.created_at,
      on_watchlist: watch.get(key) ?? null,
      in_golden: goldenNames.get(key) ?? null,
    };
    group.count += 1;
    if (row.url && !group.urls.includes(row.url) && group.urls.length < 5) group.urls.push(row.url);
    if (row.created_at < group.first_at) group.first_at = row.created_at;
    if (row.created_at > group.last_at) group.last_at = row.created_at;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last_at.localeCompare(a.last_at) || a.name.localeCompare(b.name));
}

export function goldenNameMap(root?: string): Map<string, string> {
  return new Map(readGoldenIndex(root).festivals.map((festival) => [normalizeName(festival.name), festival.slug]));
}

// Editing ------------------------------------------------------------------------------------------

export interface AddOptions {
  slug?: string;
  name: string;
  tier: Tier;
  year?: number | null;
  officialUrl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  addedBy?: string | null;
  now?: string;
  root?: string;
}

export function addWatchlistEntry(options: AddOptions): { watchlist: Watchlist; entry: WatchlistEntry; replaced: boolean } {
  const watchlist = readWatchlist(options.root);
  const slug = options.slug ?? slugify(options.name, options.year ?? undefined);
  if (!isSlug(slug)) {
    throw new Error(`"${slug}" is not a valid slug (^[a-z0-9]+(-[a-z0-9]+)*$); pass --slug`);
  }
  if (!TIERS.includes(options.tier)) {
    throw new Error(`tier must be one of ${TIERS.join(', ')}`);
  }
  if (options.officialUrl && !/^https:\/\//.test(options.officialUrl)) {
    throw new Error('official url must start with https://');
  }
  for (const [field, value] of [['start', options.startDate], ['end', options.endDate]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`--${field} must be YYYY-MM-DD`);
    }
  }
  const existing = watchlist.festivals.find((entry) => entry.slug === slug);
  const entry: WatchlistEntry = {
    slug,
    name: options.name.trim(),
    year: options.year ?? existing?.year ?? null,
    tier: options.tier,
    official_url: options.officialUrl ?? existing?.official_url ?? null,
    start_date: options.startDate ?? existing?.start_date ?? null,
    end_date: options.endDate ?? existing?.end_date ?? null,
    festival_id: existing?.festival_id ?? null,
    status: existing?.status ?? 'watching',
    note: options.note ?? existing?.note ?? null,
    added_by: options.addedBy ?? existing?.added_by ?? null,
    added_at: existing?.added_at || options.now || new Date().toISOString(),
  };
  const festivals = existing ? watchlist.festivals.map((item) => (item.slug === slug ? entry : item)) : [...watchlist.festivals, entry];
  const next = { version: 1 as const, festivals };
  writeWatchlist(next, options.root);
  return { watchlist: next, entry, replaced: Boolean(existing) };
}

export function setWatchlistStatus(slug: string, status: WatchStatus, root?: string): WatchlistEntry {
  const watchlist = readWatchlist(root);
  const entry = watchlist.festivals.find((item) => item.slug === slug);
  if (!entry) {
    throw new Error(`"${slug}" is not on the watchlist`);
  }
  entry.status = status;
  writeWatchlist(watchlist, root);
  return entry;
}

export function removeWatchlistEntry(slug: string, root?: string): boolean {
  const watchlist = readWatchlist(root);
  const before = watchlist.festivals.length;
  watchlist.festivals = watchlist.festivals.filter((entry) => entry.slug !== slug);
  writeWatchlist(watchlist, root);
  return watchlist.festivals.length < before;
}

// Formatting ---------------------------------------------------------------------------------------

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width);
}

export function formatWatchlistTable(entries: ScoredEntry[], options: { signalsLoaded: boolean }): string {
  if (entries.length === 0) {
    return 'Watchlist is empty. Add one: npm run admin -- watchlist:add --name "<festival>" --tier A [--url <official>] [--start YYYY-MM-DD]';
  }
  const header = `${pad('score', 6)}${pad('scout', 6)}${pad('tier', 5)}${pad('status', 16)}${pad('slug', 28)}${pad('start', 11)}${pad('asks', 5)}${pad('follows', 8)}name`;
  const lines = entries.map(
    (entry) =>
      `${pad(entry.score, 6)}${pad(entry.scout ? 'yes' : '-', 6)}${pad(entry.tier, 5)}${pad(entry.status, 16)}${pad(entry.slug, 28)}${pad(entry.start_date ?? '-', 11)}${pad(entry.suggestions, 5)}${pad(entry.follows, 8)}${entry.name}`,
  );
  const note = options.signalsLoaded
    ? `Scheduled scouting takes "scout = yes" (score ≥ ${SCOUT_THRESHOLD}); an admin request may name any slug.`
    : `Offline: asks/follows are 0 (set SUPABASE_URL and the service key to count them). Scheduled scouting takes "scout = yes" (score ≥ ${SCOUT_THRESHOLD}).`;
  return [header, ...lines, note].join('\n');
}

export function formatSuggestionRanking(groups: SuggestionGroup[]): string {
  if (groups.length === 0) {
    return 'No suggestions yet.';
  }
  const header = `${pad('asks', 6)}${pad('last', 11)}${pad('watchlist', 24)}${pad('golden', 20)}name`;
  const lines = groups.map(
    (group) =>
      `${pad(group.count, 6)}${pad(group.last_at.slice(0, 10), 11)}${pad(group.on_watchlist ?? '-', 24)}${pad(group.in_golden ?? '-', 20)}${group.name}${group.urls.length ? `  (${group.urls[0]})` : ''}`,
  );
  return [header, ...lines].join('\n');
}
