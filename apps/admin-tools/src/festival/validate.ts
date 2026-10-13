import { isUuid } from '../lib/uuid';
import {
  addDays,
  isValidDateString,
  isValidTimeZone,
  localDateOf,
  parseOffsetTimestamp,
} from '../lib/time';
import {
  SET_STATUSES,
  type ArtistRecord,
  type FestivalRecord,
  type FestivalSeed,
  type FestivalStatus,
  type SetRecord,
  type SetStatus,
  type StageRecord,
  type ValidationIssue,
  type ValidationResult,
} from './types';

/**
 * Strict validation of a festival file (docs/festival-data.md). Collects every
 * problem instead of stopping at the first one, and returns a normalized seed
 * (defaults filled in) only when there are no errors.
 */

const FESTIVAL_KEYS = [
  'id', 'name', 'start_date', 'end_date', 'timezone', 'venue_name', 'status', 'is_demo', 'source_url',
  'accent_color', 'latitude', 'longitude', 'default_zoom', 'bounds_sw_lat', 'bounds_sw_lng', 'bounds_ne_lat',
  'bounds_ne_lng', 'version', 'image_url', 'map_asset_url',
] as const;
const STAGE_KEYS = ['id', 'festival_id', 'name', 'zone', 'latitude', 'longitude'] as const;
const ARTIST_KEYS = ['id', 'name', 'genre', 'image_url', 'billing_order'] as const;
const SET_KEYS = [
  'id', 'festival_id', 'artist_id', 'stage_id', 'start_time', 'end_time', 'set_type', 'status', 'original_start_time',
  'change_note',
] as const;
const TOP_KEYS = ['festival', 'stages', 'artists', 'sets'] as const;

export const LIMITS = {
  festivalName: 120,
  venueName: 120,
  stageName: 80,
  zone: 40,
  artistName: 120,
  genre: 60,
  setType: 40,
  changeNote: 140,
  maxSetHours: 24,
  maxBillingOrder: 10000,
} as const;

const ACCENT_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

type Json = Record<string, unknown>;

class Collector {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];

  error(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  warn(path: string, message: string): void {
    this.warnings.push({ path, message });
  }

  object(value: unknown, path: string): Json | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.error(path, 'must be an object');
      return null;
    }
    return value as Json;
  }

  keys(value: Json, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.error(`${path}.${key}`, `unknown field (allowed: ${allowed.join(', ')})`);
      }
    }
  }

  uuid(value: unknown, path: string): string {
    if (!isUuid(value)) {
      this.error(path, 'must be a UUID');
      return '';
    }
    return value.toLowerCase();
  }

  text(value: unknown, path: string, max: number): string {
    if (typeof value !== 'string' || value.trim() === '') {
      this.error(path, 'is required and must be a non-empty string');
      return '';
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
      this.error(path, `must be at most ${max} characters (got ${trimmed.length})`);
    }
    return trimmed;
  }

  optionalText(value: unknown, path: string, max: number): string | null {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      return null;
    }
    return this.text(value, path, max);
  }

  optionalNumber(value: unknown, path: string, min: number, max: number): number | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.error(path, 'must be a finite number');
      return null;
    }
    if (value < min || value > max) {
      this.error(path, `must be between ${min} and ${max}`);
    }
    return value;
  }

  boolean(value: unknown, path: string, fallback: boolean): boolean {
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value !== 'boolean') {
      this.error(path, 'must be true or false');
      return fallback;
    }
    return value;
  }

  mustBeAbsent(value: unknown, path: string, reason: string): void {
    if (value !== undefined && value !== null) {
      this.error(path, reason);
    }
  }
}

function validateCoordinatePair(
  c: Collector,
  path: string,
  latitude: unknown,
  longitude: unknown,
): { latitude: number | null; longitude: number | null } {
  const lat = c.optionalNumber(latitude, `${path}.latitude`, -90, 90);
  const lng = c.optionalNumber(longitude, `${path}.longitude`, -180, 180);
  if ((lat === null) !== (lng === null)) {
    c.error(path, 'latitude and longitude must be given together');
  }
  return { latitude: lat, longitude: lng };
}

function validateSourceUrl(c: Collector, value: unknown, path: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) {
      c.error(path, 'is required for real festivals: link the official public schedule you entered the data from');
    }
    return null;
  }
  if (typeof value !== 'string') {
    c.error(path, 'must be a URL string');
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    c.error(path, 'must be an absolute URL');
    return null;
  }
  if (url.protocol !== 'https:') {
    c.error(path, 'must use https');
  }
  return url.toString();
}

function validateFestival(c: Collector, raw: unknown): FestivalRecord | null {
  const f = c.object(raw, 'festival');
  if (!f) {
    return null;
  }
  c.keys(f, 'festival', FESTIVAL_KEYS);

  const id = c.uuid(f.id, 'festival.id');
  const name = c.text(f.name, 'festival.name', LIMITS.festivalName);
  const venueName = c.optionalText(f.venue_name, 'festival.venue_name', LIMITS.venueName);

  const startDate = f.start_date;
  const endDate = f.end_date;
  if (!isValidDateString(startDate)) {
    c.error('festival.start_date', 'must be a calendar date YYYY-MM-DD');
  }
  if (!isValidDateString(endDate)) {
    c.error('festival.end_date', 'must be a calendar date YYYY-MM-DD');
  }
  if (isValidDateString(startDate) && isValidDateString(endDate) && endDate < startDate) {
    c.error('festival.end_date', 'must be on or after start_date');
  }

  const timezone = f.timezone;
  if (!isValidTimeZone(timezone)) {
    c.error('festival.timezone', 'must be an IANA time zone such as America/Chicago');
  }

  let status: FestivalStatus = 'draft';
  if (f.status !== undefined && f.status !== null) {
    if (f.status === 'draft' || f.status === 'published') {
      status = f.status;
    } else {
      c.error('festival.status', 'must be "draft" or "published"');
    }
  }

  const isDemo = c.boolean(f.is_demo, 'festival.is_demo', false);
  const sourceUrl = validateSourceUrl(c, f.source_url, 'festival.source_url', !isDemo);

  let accentColor: string | null = null;
  if (f.accent_color !== undefined && f.accent_color !== null) {
    if (typeof f.accent_color === 'string' && ACCENT_COLOR_PATTERN.test(f.accent_color)) {
      accentColor = f.accent_color.toUpperCase();
    } else {
      c.error('festival.accent_color', 'must be a hex color like #B2CEFE');
    }
  }

  const center = validateCoordinatePair(c, 'festival', f.latitude, f.longitude);
  const defaultZoom = c.optionalNumber(f.default_zoom, 'festival.default_zoom', 0, 22);

  const bounds = {
    bounds_sw_lat: c.optionalNumber(f.bounds_sw_lat, 'festival.bounds_sw_lat', -90, 90),
    bounds_sw_lng: c.optionalNumber(f.bounds_sw_lng, 'festival.bounds_sw_lng', -180, 180),
    bounds_ne_lat: c.optionalNumber(f.bounds_ne_lat, 'festival.bounds_ne_lat', -90, 90),
    bounds_ne_lng: c.optionalNumber(f.bounds_ne_lng, 'festival.bounds_ne_lng', -180, 180),
  };
  const boundValues = Object.values(bounds);
  const boundsGiven = boundValues.filter((value) => value !== null).length;
  if (boundsGiven !== 0 && boundsGiven !== 4) {
    c.error('festival', 'bounds_sw_lat, bounds_sw_lng, bounds_ne_lat and bounds_ne_lng must be given together');
  }
  if (boundsGiven === 4) {
    if (bounds.bounds_sw_lat! >= bounds.bounds_ne_lat!) {
      c.error('festival.bounds_sw_lat', 'must be south of bounds_ne_lat');
    }
    if (bounds.bounds_sw_lng! >= bounds.bounds_ne_lng!) {
      c.error('festival.bounds_sw_lng', 'must be west of bounds_ne_lng');
    }
    if (boundsGiven === 4 && center.latitude !== null && center.longitude !== null) {
      if (!isInsideBounds(center.latitude, center.longitude, bounds)) {
        c.error('festival', 'latitude/longitude must lie inside the bounds');
      }
    }
    if (center.latitude === null) {
      c.error('festival', 'bounds require a center latitude/longitude');
    }
  }

  let version: number | undefined;
  if (f.version !== undefined && f.version !== null) {
    if (typeof f.version !== 'number' || !Number.isInteger(f.version) || f.version < 1) {
      c.error('festival.version', 'must be a positive integer');
    } else {
      version = f.version;
    }
  }

  c.mustBeAbsent(f.image_url, 'festival.image_url', 'must be null: do not use festival logos or artwork (see docs/festival-data.md)');
  c.mustBeAbsent(f.map_asset_url, 'festival.map_asset_url', 'must be null: do not use official map artwork (see docs/festival-data.md)');

  if (status === 'published' && !isDemo && sourceUrl === null) {
    c.error('festival.status', 'a published real festival needs a source_url');
  }

  return {
    id,
    name,
    start_date: typeof startDate === 'string' ? startDate : '',
    end_date: typeof endDate === 'string' ? endDate : '',
    timezone: typeof timezone === 'string' ? timezone : '',
    venue_name: venueName,
    status,
    is_demo: isDemo,
    source_url: sourceUrl,
    accent_color: accentColor,
    latitude: center.latitude,
    longitude: center.longitude,
    default_zoom: defaultZoom,
    ...bounds,
    ...(version === undefined ? {} : { version }),
  };
}

interface Bounds {
  bounds_sw_lat: number | null;
  bounds_sw_lng: number | null;
  bounds_ne_lat: number | null;
  bounds_ne_lng: number | null;
}

export function isInsideBounds(latitude: number, longitude: number, bounds: Bounds): boolean {
  return (
    bounds.bounds_sw_lat !== null &&
    bounds.bounds_sw_lng !== null &&
    bounds.bounds_ne_lat !== null &&
    bounds.bounds_ne_lng !== null &&
    latitude >= bounds.bounds_sw_lat &&
    latitude <= bounds.bounds_ne_lat &&
    longitude >= bounds.bounds_sw_lng &&
    longitude <= bounds.bounds_ne_lng
  );
}

function validateArray(c: Collector, raw: unknown, path: string): unknown[] {
  if (!Array.isArray(raw)) {
    c.error(path, 'must be an array');
    return [];
  }
  return raw;
}

function checkFestivalRef(c: Collector, value: unknown, path: string, festivalId: string): string {
  if (value === undefined || value === null) {
    return festivalId;
  }
  const ref = c.uuid(value, path);
  if (ref && festivalId && ref !== festivalId) {
    c.error(path, 'must equal festival.id (or be omitted)');
  }
  return festivalId;
}

function validateStages(c: Collector, raw: unknown, festival: FestivalRecord | null): StageRecord[] {
  const festivalId = festival?.id ?? '';
  const ids = new Set<string>();
  const names = new Map<string, number>();
  return validateArray(c, raw, 'stages').flatMap((item, index) => {
    const path = `stages[${index}]`;
    const s = c.object(item, path);
    if (!s) {
      return [];
    }
    c.keys(s, path, STAGE_KEYS);
    const id = c.uuid(s.id, `${path}.id`);
    if (id && ids.has(id)) {
      c.error(`${path}.id`, `duplicate stage id ${id}`);
    }
    ids.add(id);
    const name = c.text(s.name, `${path}.name`, LIMITS.stageName);
    const key = name.toLowerCase();
    if (name && names.has(key)) {
      c.error(`${path}.name`, `duplicate stage name (also stages[${names.get(key)}])`);
    }
    names.set(key, index);
    const coordinates = validateCoordinatePair(c, path, s.latitude, s.longitude);
    if (
      festival &&
      coordinates.latitude !== null &&
      coordinates.longitude !== null &&
      festival.bounds_sw_lat !== null &&
      !isInsideBounds(coordinates.latitude, coordinates.longitude, festival)
    ) {
      c.error(path, 'stage coordinates must lie inside the festival bounds');
    }
    if (festival && festival.latitude !== null && coordinates.latitude === null) {
      c.warn(path, 'stage has no coordinates; it will not appear on the map');
    }
    return [
      {
        id,
        festival_id: checkFestivalRef(c, s.festival_id, `${path}.festival_id`, festivalId),
        name,
        zone: c.optionalText(s.zone, `${path}.zone`, LIMITS.zone),
        ...coordinates,
      },
    ];
  });
}

function validateArtists(c: Collector, raw: unknown): ArtistRecord[] {
  const ids = new Set<string>();
  const names = new Map<string, number>();
  return validateArray(c, raw, 'artists').flatMap((item, index) => {
    const path = `artists[${index}]`;
    const a = c.object(item, path);
    if (!a) {
      return [];
    }
    c.keys(a, path, ARTIST_KEYS);
    const id = c.uuid(a.id, `${path}.id`);
    if (id && ids.has(id)) {
      c.error(`${path}.id`, `duplicate artist id ${id}`);
    }
    ids.add(id);
    const name = c.text(a.name, `${path}.name`, LIMITS.artistName);
    const key = name.toLowerCase();
    if (name && names.has(key)) {
      c.error(`${path}.name`, `duplicate artist name (also artists[${names.get(key)}])`);
    }
    names.set(key, index);
    c.mustBeAbsent(a.image_url, `${path}.image_url`, 'must be null: do not use artist photos or artwork');

    // Position or tier as the organizer lists the lineup; acts sharing a number sort alphabetically
    // within it, so a repeated value is normal (a poster's tiers), not a mistake.
    let billingOrder: number | undefined;
    if (a.billing_order !== undefined && a.billing_order !== null) {
      if (typeof a.billing_order !== 'number' || !Number.isInteger(a.billing_order) || a.billing_order < 1 || a.billing_order > LIMITS.maxBillingOrder) {
        c.error(`${path}.billing_order`, `must be an integer between 1 and ${LIMITS.maxBillingOrder} (1 = top billing)`);
      } else {
        billingOrder = a.billing_order;
      }
    }
    return [
      {
        id,
        name,
        genre: c.optionalText(a.genre, `${path}.genre`, LIMITS.genre),
        ...(billingOrder === undefined ? {} : { billing_order: billingOrder }),
      },
    ];
  });
}

function validateSets(
  c: Collector,
  raw: unknown,
  festival: FestivalRecord | null,
  stages: StageRecord[],
  artists: ArtistRecord[],
): SetRecord[] {
  const festivalId = festival?.id ?? '';
  const stageIds = new Set(stages.map((stage) => stage.id));
  const artistIds = new Set(artists.map((artist) => artist.id));
  const ids = new Set<string>();
  const datesUsable =
    festival !== null &&
    isValidDateString(festival.start_date) &&
    isValidDateString(festival.end_date) &&
    isValidTimeZone(festival.timezone);
  const earliestDate = datesUsable ? addDays(festival!.start_date, -1) : '';
  const latestDate = datesUsable ? addDays(festival!.end_date, 1) : '';

  const sets = validateArray(c, raw, 'sets').flatMap((item, index) => {
    const path = `sets[${index}]`;
    const s = c.object(item, path);
    if (!s) {
      return [];
    }
    c.keys(s, path, SET_KEYS);
    const id = c.uuid(s.id, `${path}.id`);
    if (id && ids.has(id)) {
      c.error(`${path}.id`, `duplicate set id ${id}`);
    }
    ids.add(id);

    const artistId = c.uuid(s.artist_id, `${path}.artist_id`);
    if (artistId && !artistIds.has(artistId)) {
      c.error(`${path}.artist_id`, 'does not match any artist in this file');
    }
    const stageId = c.uuid(s.stage_id, `${path}.stage_id`);
    if (stageId && !stageIds.has(stageId)) {
      c.error(`${path}.stage_id`, 'does not match any stage in this file');
    }

    const start = parseOffsetTimestamp(s.start_time);
    const end = parseOffsetTimestamp(s.end_time);
    if (!start) {
      c.error(`${path}.start_time`, 'must be an ISO 8601 timestamp with an offset, e.g. 2027-06-18T19:30:00-04:00');
    }
    if (!end) {
      c.error(`${path}.end_time`, 'must be an ISO 8601 timestamp with an offset, e.g. 2027-06-18T20:30:00-04:00');
    }
    if (start && end) {
      if (end.getTime() <= start.getTime()) {
        c.error(`${path}.end_time`, 'must be after start_time');
      } else if (end.getTime() - start.getTime() > LIMITS.maxSetHours * 3_600_000) {
        c.error(`${path}.end_time`, `sets longer than ${LIMITS.maxSetHours} hours are not allowed`);
      }
    }
    if (start && datesUsable) {
      const localDate = localDateOf(start, festival!.timezone);
      if (localDate < earliestDate || localDate > latestDate) {
        c.error(
          `${path}.start_time`,
          `starts on ${localDate} (${festival!.timezone}), outside the festival dates ±1 day (${earliestDate}..${latestDate})`,
        );
      }
    }

    let setType = 'performance';
    if (s.set_type !== undefined && s.set_type !== null) {
      setType = c.text(s.set_type, `${path}.set_type`, LIMITS.setType);
    }

    const change = validateSetChange(c, s, path, start, datesUsable ? { festival: festival!, earliestDate, latestDate } : null);

    return [
      {
        id,
        festival_id: checkFestivalRef(c, s.festival_id, `${path}.festival_id`, festivalId),
        artist_id: artistId,
        stage_id: stageId,
        start_time: typeof s.start_time === 'string' ? s.start_time : '',
        end_time: typeof s.end_time === 'string' ? s.end_time : '',
        set_type: setType,
        ...change,
      },
    ];
  });

  // Overlapping sets on one stage are usually a data-entry mistake (a cancelled set frees its slot).
  const byStage = new Map<string, Array<{ index: number; start: number; end: number }>>();
  sets.forEach((set, index) => {
    const start = parseOffsetTimestamp(set.start_time);
    const end = parseOffsetTimestamp(set.end_time);
    if (!start || !end || !set.stage_id || set.status === 'cancelled') {
      return;
    }
    const list = byStage.get(set.stage_id) ?? [];
    list.push({ index, start: start.getTime(), end: end.getTime() });
    byStage.set(set.stage_id, list);
  });
  for (const list of byStage.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start < list[i - 1].end) {
        c.warn(`sets[${list[i].index}]`, `overlaps sets[${list[i - 1].index}] on the same stage`);
      }
    }
  }

  return sets;
}

/**
 * `status`, `original_start_time` and `change_note` of one set, matching the checks of migration
 * 011. Always returns all three so a re-seed also clears a change that was removed from the file.
 */
function validateSetChange(
  c: Collector,
  s: Json,
  path: string,
  start: Date | null,
  dates: { festival: FestivalRecord; earliestDate: string; latestDate: string } | null,
): Pick<SetRecord, 'status' | 'original_start_time' | 'change_note'> {
  let status: SetStatus = 'scheduled';
  if (s.status !== undefined && s.status !== null) {
    if (typeof s.status === 'string' && (SET_STATUSES as readonly string[]).includes(s.status)) {
      status = s.status as SetStatus;
    } else {
      c.error(`${path}.status`, `must be one of ${SET_STATUSES.join(', ')}`);
    }
  }

  let originalStartTime: string | null = null;
  if (s.original_start_time !== undefined && s.original_start_time !== null) {
    const original = parseOffsetTimestamp(s.original_start_time);
    if (status !== 'moved') {
      c.error(`${path}.original_start_time`, 'is only allowed when status is "moved"');
    } else if (!original) {
      c.error(`${path}.original_start_time`, 'must be an ISO 8601 timestamp with an offset, e.g. 2027-06-18T19:30:00-04:00');
    } else {
      originalStartTime = s.original_start_time as string;
      if (start && original.getTime() === start.getTime()) {
        c.warn(`${path}.original_start_time`, 'equals start_time; leave it empty for a set that only changed stage');
      }
      if (dates) {
        const localDate = localDateOf(original, dates.festival.timezone);
        if (localDate < dates.earliestDate || localDate > dates.latestDate) {
          c.error(
            `${path}.original_start_time`,
            `is on ${localDate} (${dates.festival.timezone}), outside the festival dates ±1 day (${dates.earliestDate}..${dates.latestDate})`,
          );
        }
      }
    }
  } else if (status === 'moved') {
    c.warn(`${path}.original_start_time`, 'is empty: the app shows "Moved" without the old time');
  }

  let changeNote: string | null = null;
  if (s.change_note !== undefined && s.change_note !== null) {
    if (typeof s.change_note === 'string' && /[\r\n\t]/.test(s.change_note)) {
      c.error(`${path}.change_note`, 'must be a single line');
    } else {
      changeNote = c.optionalText(s.change_note, `${path}.change_note`, LIMITS.changeNote);
    }
  }

  return { status, original_start_time: originalStartTime, change_note: changeNote };
}

export function validateFestivalSeed(input: unknown): ValidationResult {
  const c = new Collector();
  const root = c.object(input, '$');
  if (!root) {
    return { seed: null, errors: c.errors, warnings: c.warnings };
  }
  c.keys(root, '$', TOP_KEYS);

  const festival = validateFestival(c, root.festival);
  const stages = validateStages(c, root.stages, festival);
  const artists = validateArtists(c, root.artists);
  const sets = validateSets(c, root.sets, festival, stages, artists);

  // Announcement mode (migration 014): a festival can be published once its lineup is official,
  // before set times exist. The app then lists the acts under "set times to be announced".
  if (festival && festival.status === 'published' && artists.length === 0) {
    c.error('artists', 'a published festival needs a lineup: at least one artist (set times can follow later)');
  }
  const unscheduled = artists.filter((artist) => !sets.some((set) => set.artist_id === artist.id));
  if (festival?.is_demo && sets.length === 0) {
    c.error('sets', "the demo festival needs set times: demo:seed builds the sample crew's picks and meetups from them");
  } else if (artists.length > 0 && sets.length === 0) {
    c.warn('sets', 'no set times yet: the app shows the lineup as "set times to be announced"');
  } else if (unscheduled.length > 0) {
    c.warn(
      'artists',
      `${unscheduled.length} of ${artists.length} artists have no set yet (${unscheduled
        .slice(0, 5)
        .map((artist) => artist.name)
        .join(', ')}${unscheduled.length > 5 ? ', …' : ''}): the app lists them under "set times to be announced"`,
    );
  }

  if (c.errors.length > 0 || !festival) {
    return { seed: null, errors: c.errors, warnings: c.warnings };
  }
  return { seed: { festival, stages, artists, sets }, errors: [], warnings: c.warnings };
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n');
}
