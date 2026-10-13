/**
 * Display-ready view of a candidate bundle for the local review page (./server.ts, ./page.html).
 * Pure: takes what `loadCandidate` returned and derives festival facts, stages, artists with their
 * image candidate, and sets grouped by festival day with times in the festival's time zone. Per-row
 * provenance comes from `candidate.json` (`items.sets`, keyed `<artist>|<YYYY-MM-DD HH:MM>`).
 */
import type { LoadedCandidate } from '../candidates/store';
import type {
  CandidateAgentRun,
  CandidateFile,
  CandidateReview,
  CandidateSection,
  CandidateSource,
  CandidateStatus,
  Confidence,
  RowProvenance,
} from '../candidates/types';
import { buildSeedFromCsv, type CsvInput } from '../festival/import-csv';
import type { ArtistRecord, FestivalRecord, FestivalSeed, SetRecord, StageRecord, ValidationIssue } from '../festival/types';
import { addDays, daysBetween, festivalDayOf, parseOffsetTimestamp, wallTimeIn } from '../lib/time';
import type { MediaEntry } from '../media/types';

/** An instant shown in the festival's time zone. */
export interface TimeView {
  /** The stored ISO 8601 string (with offset). */
  iso: string;
  /** Calendar date in the festival zone, YYYY-MM-DD. */
  date: string;
  /** 24-hour wall clock, HH:MM. */
  time: string;
  /** 12-hour wall clock, e.g. "4:30 PM". */
  label: string;
}

export interface ProvenanceView extends RowProvenance {
  /** The key as written in candidate.json. */
  key: string;
}

export interface MediaView {
  /** Position in `media/registry.json` (what `POST .../media/:index` takes). */
  index: number;
  subject_type: MediaEntry['subject_type'];
  subject_id: string;
  subject_name: string;
  file: string;
  /** Where the review server serves the image: `/media/<slug>/<file>`. */
  url: string;
  mime: MediaEntry['mime'];
  width: number | null;
  height: number | null;
  sha256: string;
  source: MediaEntry['source'];
  license: MediaEntry['license'];
  review: MediaEntry['review'];
}

export interface StageView extends StageRecord {
  setCount: number;
}

export interface ArtistView extends ArtistRecord {
  setCount: number;
  media: MediaView | null;
  provenance: ProvenanceView | null;
}

export interface SetView {
  id: string;
  artist_id: string;
  artist: string;
  stage_id: string;
  stage: string;
  /** Festival day (YYYY-MM-DD; sets before 06:00 belong to the night before), or "unknown". */
  day: string;
  start: TimeView | null;
  end: TimeView | null;
  set_type: string;
  status: SetRecord['status'];
  original_start: TimeView | null;
  change_note: string | null;
  provenance: ProvenanceView | null;
}

export interface DayView {
  date: string;
  /** E.g. "Sat, Oct 10" ("Unknown day" for sets whose times could not be read). */
  label: string;
  /** False for a day outside festival.start_date..end_date (worth a look). */
  inRange: boolean;
  sets: SetView[];
}

export interface SourceView extends CandidateSource {
  /** Position in `candidate.json.sources`; provenance refers to it. */
  index: number;
}

export interface CandidateView {
  slug: string;
  name: string;
  status: CandidateStatus;
  created_at: string;
  trigger: CandidateFile['trigger'];
  agent: CandidateAgentRun;
  promoted: CandidateFile['promoted'] | null;
  /** Where the lineup came from: the validated seed, the raw CSVs (validation failed), or nothing. */
  seedSource: 'validated' | 'unvalidated' | 'none';
  festival: FestivalRecord | null;
  stages: StageView[];
  artists: ArtistView[];
  days: DayView[];
  media: { entries: MediaView[]; unmatched: MediaView[]; counts: { pending: number; approved: number; rejected: number } };
  validation: { errors: ValidationIssue[]; warnings: ValidationIssue[] };
  sources: SourceView[];
  confidence: Record<CandidateSection, Confidence>;
  notes: string;
  review: CandidateReview;
  reviewMarkdown: string | null;
  /** `unscheduled`: artists without a set ("set times to be announced", docs/festival-data.md §4.2). */
  counts: { stages: number; artists: number; sets: number; days: number; unscheduled: number };
}

const UNKNOWN_DAY = 'unknown';

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function timeView(iso: string | null | undefined, timeZone: string): TimeView | null {
  const instant = parseOffsetTimestamp(iso);
  if (!instant) {
    return null;
  }
  const wall = wallTimeIn(instant, timeZone);
  const hour12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  return {
    iso: iso as string,
    date: `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`,
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
    label: `${hour12}:${pad(wall.minute)} ${wall.hour < 12 ? 'AM' : 'PM'}`,
  };
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

/** "Sat, Oct 10" for a YYYY-MM-DD date. */
export function dayLabel(date: string): string {
  if (date === UNKNOWN_DAY || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return 'Unknown day';
  }
  return DAY_LABEL.format(new Date(`${date}T12:00:00Z`));
}

/** The CSVs as a seed even when validation failed, so the reviewer still sees the lineup. */
function unvalidatedSeed(csv: CsvInput | null | undefined): FestivalSeed | null {
  if (!csv) {
    return null;
  }
  try {
    const built = buildSeedFromCsv(csv);
    return built.seed ? (built.seed as unknown as FestivalSeed) : null;
  } catch {
    return null;
  }
}

function provenanceMap(items: Record<string, RowProvenance> | undefined): Map<string, ProvenanceView> {
  const map = new Map<string, ProvenanceView>();
  for (const [key, row] of Object.entries(items ?? {})) {
    map.set(normalizeKey(key), { ...row, key });
  }
  return map;
}

function mediaView(entry: MediaEntry, index: number, slug: string): MediaView {
  return {
    index,
    subject_type: entry.subject_type,
    subject_id: entry.subject_id,
    subject_name: entry.subject_name,
    file: entry.file,
    url: `/media/${encodeURIComponent(slug)}/${entry.file.split('/').map(encodeURIComponent).join('/')}`,
    mime: entry.mime,
    width: entry.width,
    height: entry.height,
    sha256: entry.sha256,
    source: entry.source,
    license: entry.license,
    review: entry.review,
  };
}

export function buildCandidateView(loaded: LoadedCandidate): CandidateView {
  const { file } = loaded;
  const slug = file.slug;
  let seedSource: CandidateView['seedSource'] = 'validated';
  let seed: FestivalSeed | null = loaded.seed;
  if (!seed) {
    seed = unvalidatedSeed(loaded.csv);
    seedSource = seed ? 'unvalidated' : 'none';
  }

  const timeZone = seed?.festival.timezone ?? 'UTC';
  const setProvenance = provenanceMap(file.items?.sets);
  const artistProvenance = provenanceMap(file.items?.artists);

  const stageNames = new Map<string, string>();
  const artistNames = new Map<string, string>();
  const setCounts = new Map<string, number>();
  for (const stage of seed?.stages ?? []) {
    stageNames.set(stage.id, stage.name);
  }
  for (const artist of seed?.artists ?? []) {
    artistNames.set(artist.id, artist.name);
  }

  const sets: SetView[] = (seed?.sets ?? []).map((set) => {
    const artist = artistNames.get(set.artist_id) ?? set.artist_id;
    const start = timeView(set.start_time, timeZone);
    const originalStart = timeView(set.original_start_time, timeZone);
    setCounts.set(`artist:${set.artist_id}`, (setCounts.get(`artist:${set.artist_id}`) ?? 0) + 1);
    setCounts.set(`stage:${set.stage_id}`, (setCounts.get(`stage:${set.stage_id}`) ?? 0) + 1);
    const provenance =
      (start && setProvenance.get(normalizeKey(`${artist}|${start.date} ${start.time}`))) ??
      (originalStart && setProvenance.get(normalizeKey(`${artist}|${originalStart.date} ${originalStart.time}`))) ??
      null;
    return {
      id: set.id,
      artist_id: set.artist_id,
      artist,
      stage_id: set.stage_id,
      stage: stageNames.get(set.stage_id) ?? set.stage_id,
      day: start ? festivalDayOf(new Date(start.iso), timeZone) : UNKNOWN_DAY,
      start,
      end: timeView(set.end_time, timeZone),
      set_type: set.set_type,
      status: set.status,
      original_start: originalStart,
      change_note: set.change_note,
      provenance,
    };
  });

  // Days: the festival's date range plus any day that has sets (an out-of-range day is a finding).
  const dayDates = new Set<string>();
  const festival = seed?.festival ?? null;
  if (festival && /^\d{4}-\d{2}-\d{2}$/.test(festival.start_date) && /^\d{4}-\d{2}-\d{2}$/.test(festival.end_date)) {
    const span = daysBetween(festival.start_date, festival.end_date);
    for (let offset = 0; offset <= Math.min(Math.max(span, 0), 31); offset += 1) {
      dayDates.add(addDays(festival.start_date, offset));
    }
  }
  for (const set of sets) {
    dayDates.add(set.day);
  }
  const inRange = (date: string): boolean =>
    Boolean(festival && date !== UNKNOWN_DAY && date >= festival.start_date && date <= festival.end_date);
  const days: DayView[] = [...dayDates]
    .sort((a, b) => (a === UNKNOWN_DAY ? 1 : b === UNKNOWN_DAY ? -1 : a.localeCompare(b)))
    .map((date) => ({
      date,
      label: dayLabel(date),
      inRange: inRange(date),
      sets: sets
        .filter((set) => set.day === date)
        .sort(
          (a, b) =>
            (a.start?.iso ?? '').localeCompare(b.start?.iso ?? '') ||
            a.stage.localeCompare(b.stage) ||
            a.artist.localeCompare(b.artist),
        ),
    }));

  const entries = (loaded.media?.entries ?? []).map((entry, index) => mediaView(entry, index, slug));
  const matched = new Set<number>();
  const mediaFor = (artist: ArtistRecord): MediaView | null => {
    const byId = entries.find((entry) => entry.subject_type === 'artist' && entry.subject_id === artist.id);
    const entry =
      byId ??
      entries.find((entry) => entry.subject_type === 'artist' && normalizeKey(entry.subject_name) === normalizeKey(artist.name));
    if (entry) {
      matched.add(entry.index);
    }
    return entry ?? null;
  };
  const artists: ArtistView[] = (seed?.artists ?? []).map((artist) => ({
    ...artist,
    setCount: setCounts.get(`artist:${artist.id}`) ?? 0,
    media: mediaFor(artist),
    provenance: artistProvenance.get(normalizeKey(artist.name)) ?? null,
  }));
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const entry of entries) {
    counts[entry.review.status] += 1;
  }

  return {
    slug,
    name: file.name,
    status: file.status,
    created_at: file.created_at,
    trigger: file.trigger,
    agent: file.agent,
    promoted: file.promoted ?? null,
    seedSource,
    festival,
    stages: (seed?.stages ?? []).map((stage) => ({ ...stage, setCount: setCounts.get(`stage:${stage.id}`) ?? 0 })),
    artists,
    days,
    media: { entries, unmatched: entries.filter((entry) => !matched.has(entry.index)), counts },
    validation: { errors: loaded.errors ?? [], warnings: loaded.warnings ?? [] },
    sources: file.sources.map((source, index) => ({ ...source, index })),
    confidence: file.confidence,
    notes: file.notes,
    review: file.review,
    reviewMarkdown: loaded.reviewMarkdown,
    counts: {
      stages: seed?.stages.length ?? 0,
      artists: artists.length,
      sets: sets.length,
      days: days.length,
      unscheduled: artists.filter((artist) => artist.setCount === 0).length,
    },
  };
}
