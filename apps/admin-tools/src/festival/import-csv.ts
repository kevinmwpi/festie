import { CsvError, parseCsvRecords, type CsvRecord } from '../lib/csv';
import {
  festivalDayOf,
  formatInstantInZone,
  isValidTimeZone,
  parseLocalDateTime,
  parseOffsetTimestamp,
  wallTimeExists,
  zonedTimeToInstant,
} from '../lib/time';
import { FESTIE_NAMESPACE, isUuid, uuidV5 } from '../lib/uuid';
import type { ValidationIssue } from './types';
import { LIMITS } from './validate';

/**
 * Converts the four CSV files of a festival directory into the JSON festival
 * format. Ids that are not given are derived deterministically (UUID v5), so
 * re-importing an updated schedule keeps ids stable and users keep their picks:
 *   festival: name + start_date        stage: festival + stage name
 *   artist:   artist name (global)     set:   festival + artist + festival day (+ ordinal)
 * A moved set (status "moved" with an original_start) takes its day from original_start, so it keeps
 * the id it had before the move — and users keep their picks — even when it moved to another day.
 * The result still has to pass validateFestivalSeed().
 */

export const CSV_FILES = ['festival.csv', 'stages.csv', 'artists.csv', 'sets.csv'] as const;

export const CSV_SCHEMAS = {
  'festival.csv': {
    required: ['name', 'start_date', 'end_date', 'timezone'],
    optional: [
      'id', 'venue_name', 'source_url', 'status', 'is_demo', 'accent_color', 'latitude', 'longitude',
      'default_zoom', 'bounds_sw_lat', 'bounds_sw_lng', 'bounds_ne_lat', 'bounds_ne_lng',
    ],
  },
  'stages.csv': { required: ['name'], optional: ['id', 'zone', 'latitude', 'longitude'] },
  'artists.csv': { required: ['name'], optional: ['id', 'genre', 'billing'] },
  'sets.csv': {
    required: ['artist', 'stage', 'start', 'end'],
    optional: ['id', 'set_type', 'status', 'original_start', 'note'],
  },
} as const;

export type CsvFileName = (typeof CSV_FILES)[number];
export type CsvInput = Record<CsvFileName, string>;

export interface CsvImportResult {
  /** Candidate festival file (unvalidated); null when the CSVs themselves are broken. */
  seed: Record<string, unknown> | null;
  errors: ValidationIssue[];
}

function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function at(file: string, record: CsvRecord, column?: string): string {
  return `${file}:${record.line}${column ? ` ${column}` : ''}`;
}

export function buildSeedFromCsv(input: CsvInput): CsvImportResult {
  const errors: ValidationIssue[] = [];
  const parsed = {} as Record<CsvFileName, CsvRecord[]>;
  for (const file of CSV_FILES) {
    try {
      parsed[file] = parseCsvRecords(input[file], file, CSV_SCHEMAS[file]);
    } catch (error) {
      if (error instanceof CsvError) {
        errors.push({ path: `${error.file}:${error.line}`, message: error.message.replace(/^[^:]+:\d+: /, '') });
        continue;
      }
      throw error;
    }
  }
  if (errors.length > 0) {
    return { seed: null, errors };
  }

  const number = (file: string, record: CsvRecord, column: string): number | null => {
    const raw = record.values[column];
    if (raw === undefined || raw === '') {
      return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push({ path: at(file, record, column), message: `"${raw}" is not a number` });
      return null;
    }
    return value;
  };
  const optional = (record: CsvRecord, column: string): string | null => {
    const raw = record.values[column];
    return raw === undefined || raw === '' ? null : raw;
  };

  // festival.csv ----------------------------------------------------------
  const festivalRows = parsed['festival.csv'];
  if (festivalRows.length !== 1) {
    errors.push({ path: 'festival.csv', message: `must contain exactly one festival row (found ${festivalRows.length})` });
    return { seed: null, errors };
  }
  const f = festivalRows[0];
  const timezone = f.values.timezone;
  if (!isValidTimeZone(timezone)) {
    errors.push({ path: at('festival.csv', f, 'timezone'), message: `"${timezone}" is not an IANA time zone` });
    return { seed: null, errors };
  }

  let isDemo = false;
  const rawDemo = (f.values.is_demo ?? '').toLowerCase();
  if (['true', 'yes', '1'].includes(rawDemo)) {
    isDemo = true;
  } else if (!['', 'false', 'no', '0'].includes(rawDemo)) {
    errors.push({ path: at('festival.csv', f, 'is_demo'), message: 'must be true or false' });
  }

  const providedFestivalId = optional(f, 'id');
  if (providedFestivalId !== null && !isUuid(providedFestivalId)) {
    errors.push({ path: at('festival.csv', f, 'id'), message: 'must be a UUID' });
  }
  const festivalId = (
    providedFestivalId && isUuid(providedFestivalId)
      ? providedFestivalId
      : uuidV5(`festival:${nameKey(f.values.name)}:${f.values.start_date}`, FESTIE_NAMESPACE)
  ).toLowerCase();

  const festival: Record<string, unknown> = {
    id: festivalId,
    name: f.values.name,
    start_date: f.values.start_date,
    end_date: f.values.end_date,
    timezone,
    venue_name: optional(f, 'venue_name'),
    status: optional(f, 'status') ?? 'draft',
    is_demo: isDemo,
    source_url: optional(f, 'source_url'),
    accent_color: optional(f, 'accent_color'),
    latitude: number('festival.csv', f, 'latitude'),
    longitude: number('festival.csv', f, 'longitude'),
    default_zoom: number('festival.csv', f, 'default_zoom'),
    bounds_sw_lat: number('festival.csv', f, 'bounds_sw_lat'),
    bounds_sw_lng: number('festival.csv', f, 'bounds_sw_lng'),
    bounds_ne_lat: number('festival.csv', f, 'bounds_ne_lat'),
    bounds_ne_lng: number('festival.csv', f, 'bounds_ne_lng'),
  };

  // stages.csv ------------------------------------------------------------
  const stageIdsByKey = new Map<string, string>();
  const stages = parsed['stages.csv'].map((record) => {
    const providedId = optional(record, 'id');
    if (providedId !== null && !isUuid(providedId)) {
      errors.push({ path: at('stages.csv', record, 'id'), message: 'must be a UUID' });
    }
    const id = (
      providedId && isUuid(providedId) ? providedId : uuidV5(`stage:${nameKey(record.values.name)}`, festivalId)
    ).toLowerCase();
    stageIdsByKey.set(nameKey(record.values.name), id);
    stageIdsByKey.set(id, id);
    return {
      id,
      festival_id: festivalId,
      name: record.values.name,
      zone: optional(record, 'zone'),
      latitude: number('stages.csv', record, 'latitude'),
      longitude: number('stages.csv', record, 'longitude'),
    };
  });

  // artists.csv -----------------------------------------------------------
  const artistIdsByKey = new Map<string, string>();
  const artists = parsed['artists.csv'].map((record) => {
    const providedId = optional(record, 'id');
    if (providedId !== null && !isUuid(providedId)) {
      errors.push({ path: at('artists.csv', record, 'id'), message: 'must be a UUID' });
    }
    const id = (
      providedId && isUuid(providedId) ? providedId : uuidV5(`artist:${nameKey(record.values.name)}`, FESTIE_NAMESPACE)
    ).toLowerCase();
    artistIdsByKey.set(nameKey(record.values.name), id);
    artistIdsByKey.set(id, id);
    // `billing`: 1 = top billing as the organizer lists the lineup. Left out of the JSON when empty
    // so files without billing stay as they were. The validator checks the range.
    const rawBilling = optional(record, 'billing');
    let billing: number | null = null;
    if (rawBilling !== null) {
      const trimmed = rawBilling.trim();
      billing = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
      if (!Number.isFinite(billing) || billing < 1 || billing > LIMITS.maxBillingOrder) {
        billing = Number.NaN;
        errors.push({
          path: at('artists.csv', record, 'billing'),
          message: `"${rawBilling}" must be a whole number between 1 and ${LIMITS.maxBillingOrder} (1 = top billing)`,
        });
      }
    }
    return {
      id,
      name: record.values.name,
      genre: optional(record, 'genre'),
      ...(billing === null || !Number.isFinite(billing) ? {} : { billing_order: billing }),
    };
  });

  // sets.csv --------------------------------------------------------------
  const toTimestamp = (record: CsvRecord, column: 'start' | 'end' | 'original_start'): string | null => {
    const raw = record.values[column];
    const withOffset = parseOffsetTimestamp(raw);
    if (withOffset) {
      return formatInstantInZone(withOffset, timezone);
    }
    const wall = parseLocalDateTime(raw);
    if (!wall) {
      errors.push({
        path: at('sets.csv', record, column),
        message: `"${raw}" must be "YYYY-MM-DD HH:MM" (festival local time) or ISO 8601 with an offset`,
      });
      return null;
    }
    if (!wallTimeExists(wall, timezone)) {
      errors.push({
        path: at('sets.csv', record, column),
        message: `"${raw}" does not exist in ${timezone} (skipped by a daylight-saving change)`,
      });
      return null;
    }
    return formatInstantInZone(zonedTimeToInstant(wall, timezone), timezone);
  };

  const ordinals = new Map<string, number>();
  const candidates = parsed['sets.csv'].map((record) => {
    const artistId = artistIdsByKey.get(nameKey(record.values.artist)) ?? artistIdsByKey.get(record.values.artist.toLowerCase());
    const stageId = stageIdsByKey.get(nameKey(record.values.stage)) ?? stageIdsByKey.get(record.values.stage.toLowerCase());
    if (!artistId) {
      errors.push({ path: at('sets.csv', record, 'artist'), message: `"${record.values.artist}" is not listed in artists.csv` });
    }
    if (!stageId) {
      errors.push({ path: at('sets.csv', record, 'stage'), message: `"${record.values.stage}" is not listed in stages.csv` });
    }
    const providedId = optional(record, 'id');
    if (providedId !== null && !isUuid(providedId)) {
      errors.push({ path: at('sets.csv', record, 'id'), message: 'must be a UUID' });
    }
    // Lenient like is_demo: any case, and the US spelling "canceled". The validator checks the value.
    const rawStatus = optional(record, 'status')?.trim().toLowerCase() ?? 'scheduled';
    const status = rawStatus === 'canceled' ? 'cancelled' : rawStatus;
    const originalStart = optional(record, 'original_start') === null ? null : toTimestamp(record, 'original_start');
    const start = toTimestamp(record, 'start');
    return {
      record,
      artistId,
      stageId,
      providedId: providedId && isUuid(providedId) ? providedId.toLowerCase() : null,
      start,
      end: toTimestamp(record, 'end'),
      status,
      originalStart,
      // The instant the derived id is based on: where the set was before it moved.
      idTime: status === 'moved' && originalStart ? originalStart : start,
    };
  });

  // Ordinals follow (original) start time so ids do not depend on row order.
  const ordered = [...candidates].sort((a, b) => {
    const left = a.idTime ? Date.parse(a.idTime) : 0;
    const right = b.idTime ? Date.parse(b.idTime) : 0;
    return left - right || a.record.line - b.record.line;
  });
  const setIds = new Map<CsvRecord, string>();
  for (const candidate of ordered) {
    if (candidate.providedId) {
      setIds.set(candidate.record, candidate.providedId);
      continue;
    }
    if (!candidate.artistId || !candidate.idTime) {
      continue;
    }
    const day = festivalDayOf(new Date(candidate.idTime), timezone);
    const key = `${candidate.artistId}:${day}`;
    const ordinal = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, ordinal);
    setIds.set(candidate.record, uuidV5(`set:${key}${ordinal > 1 ? `#${ordinal}` : ''}`, festivalId));
  }

  const sets = candidates.map((candidate) => ({
    id: setIds.get(candidate.record) ?? '',
    festival_id: festivalId,
    artist_id: candidate.artistId ?? '',
    stage_id: candidate.stageId ?? '',
    start_time: candidate.start ?? '',
    end_time: candidate.end ?? '',
    set_type: optional(candidate.record, 'set_type') ?? 'performance',
    status: candidate.status,
    original_start_time: candidate.originalStart,
    change_note: optional(candidate.record, 'note'),
  }));

  if (errors.length > 0) {
    return { seed: null, errors };
  }
  return { seed: { festival, stages, artists, sets }, errors: [] };
}
