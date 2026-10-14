export type FestivalStatus = 'draft' | 'published';

/** Columns of public.festivals written by admin-tools. */
export interface FestivalRecord {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  timezone: string;
  venue_name: string | null;
  status: FestivalStatus;
  is_demo: boolean;
  source_url: string | null;
  accent_color: string | null;
  latitude: number | null;
  longitude: number | null;
  default_zoom: number | null;
  bounds_sw_lat: number | null;
  bounds_sw_lng: number | null;
  bounds_ne_lat: number | null;
  bounds_ne_lng: number | null;
  /** Optional floor for the version written on seed (it is auto-bumped). */
  version?: number;
}

export interface StageRecord {
  id: string;
  festival_id: string;
  name: string;
  zone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ArtistRecord {
  id: string;
  name: string;
  genre: string | null;
  /**
   * Position in the festival's announced lineup (migration 014, `festival_artists.billing_order`):
   * 1 = top billing as the organizer lists it. Omitted = alphabetical. Per festival, not a column of
   * the global artists table.
   */
  billing_order?: number;
}

export interface SetRecord {
  id: string;
  festival_id: string;
  artist_id: string;
  stage_id: string;
  /** ISO 8601 with explicit offset, e.g. 2027-06-18T19:30:00-04:00 */
  start_time: string;
  end_time: string;
  set_type: string;
  /** Schedule change (migration 011): 'scheduled' (default) | 'moved' | 'cancelled'. */
  status: SetStatus;
  /** Start before a move, ISO 8601 with offset; only on moved sets. */
  original_start_time: string | null;
  /** Short reason shown in the app ("Moved to Sunday (weather)"), at most 140 characters. */
  change_note: string | null;
}

export const SET_STATUSES = ['scheduled', 'moved', 'cancelled'] as const;
export type SetStatus = (typeof SET_STATUSES)[number];

/**
 * The festival file format (seed-data/*.json). `artists` is the festival's announced lineup; a
 * festival can be published with artists and no sets ("set times to be announced").
 */
export interface FestivalSeed {
  festival: FestivalRecord;
  stages: StageRecord[];
  artists: ArtistRecord[];
  sets: SetRecord[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  /** Normalized seed (defaults filled in); null when there are errors. */
  seed: FestivalSeed | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
