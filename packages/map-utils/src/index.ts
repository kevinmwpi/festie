import { isCancelledSet, type Set } from '@festival/domain';

/** Mapbox order: `[longitude, latitude]`. */
export type LngLat = [number, number];

export interface CameraBounds {
  /** North-east corner `[lng, lat]`. */
  ne: LngLat;
  /** South-west corner `[lng, lat]`. */
  sw: LngLat;
}

export interface FestivalCamera {
  center: LngLat;
  zoom: number;
  bounds?: CameraBounds;
}

export interface FestivalGeo {
  latitude?: number | null;
  longitude?: number | null;
  default_zoom?: number | null;
  bounds_sw_lat?: number | null;
  bounds_sw_lng?: number | null;
  bounds_ne_lat?: number | null;
  bounds_ne_lng?: number | null;
}

export interface StageGeo {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface MeetupGeo {
  stage_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export const DEFAULT_FESTIVAL_ZOOM = 15;
/** Half-width of the fallback bounding box around a festival centre, in kilometres. */
export const FALLBACK_BOUNDS_RADIUS_KM = 1.5;

const KM_PER_DEGREE_LATITUDE = 111.32;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    isFiniteNumber(latitude) &&
    isFiniteNumber(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function toLngLat(latitude: unknown, longitude: unknown): LngLat | null {
  return isValidCoordinate(latitude, longitude) ? [longitude as number, latitude as number] : null;
}

function getExplicitBounds(festival: FestivalGeo): CameraBounds | null {
  const sw = toLngLat(festival.bounds_sw_lat, festival.bounds_sw_lng);
  const ne = toLngLat(festival.bounds_ne_lat, festival.bounds_ne_lng);
  if (!sw || !ne || sw[1] >= ne[1]) {
    return null;
  }

  return { ne, sw };
}

function getFestivalCenter(festival: FestivalGeo, bounds: CameraBounds | null): LngLat | null {
  const center = toLngLat(festival.latitude, festival.longitude);
  if (center) {
    return center;
  }

  if (!bounds) {
    return null;
  }

  // Bounds that cross the antimeridian (sw lng > ne lng) wrap around ±180.
  const lngSpan = bounds.ne[0] >= bounds.sw[0] ? bounds.ne[0] - bounds.sw[0] : bounds.ne[0] + 360 - bounds.sw[0];
  let lng = bounds.sw[0] + lngSpan / 2;
  if (lng > 180) {
    lng -= 360;
  }

  return [lng, (bounds.sw[1] + bounds.ne[1]) / 2];
}

function boundsAround(center: LngLat, radiusKm: number): CameraBounds {
  const [lng, lat] = center;
  const deltaLat = radiusKm / KM_PER_DEGREE_LATITUDE;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const deltaLng = Math.min(radiusKm / (KM_PER_DEGREE_LATITUDE * cosLat), 180);
  const clampLat = (value: number) => Math.max(-90, Math.min(90, value));
  const wrapLng = (value: number) => (value > 180 ? value - 360 : value < -180 ? value + 360 : value);

  return {
    ne: [wrapLng(lng + deltaLng), clampLat(lat + deltaLat)],
    sw: [wrapLng(lng - deltaLng), clampLat(lat - deltaLat)],
  };
}

/**
 * Festival bounds: the stored `bounds_*` box when complete and valid, otherwise the festival
 * centre ± ~1.5 km. `null` when the festival has no coordinates at all.
 */
export function getFestivalBounds(festival: FestivalGeo): CameraBounds | null {
  const explicit = getExplicitBounds(festival);
  if (explicit) {
    return explicit;
  }

  const center = getFestivalCenter(festival, null);
  return center ? boundsAround(center, FALLBACK_BOUNDS_RADIUS_KM) : null;
}

/**
 * Initial Mapbox camera for a festival, or `null` when it has no coordinates (show the
 * non-map fallback). `bounds` is only set when the festival stores an explicit bounding box.
 */
export function getFestivalCamera(festival: FestivalGeo): FestivalCamera | null {
  const explicitBounds = getExplicitBounds(festival);
  const center = getFestivalCenter(festival, explicitBounds);
  if (!center) {
    return null;
  }

  const zoom = isFiniteNumber(festival.default_zoom) && festival.default_zoom > 0 ? festival.default_zoom : DEFAULT_FESTIVAL_ZOOM;
  return explicitBounds ? { center, zoom, bounds: explicitBounds } : { center, zoom };
}

export function getStageCoordinate(stage: StageGeo | null | undefined): LngLat | null {
  return stage ? toLngLat(stage.latitude, stage.longitude) : null;
}

/**
 * A meetup's own pin when it has one, otherwise its stage's coordinate, otherwise `null`.
 */
export function getMeetupCoordinate(
  meetup: MeetupGeo,
  stagesById: ReadonlyMap<string, StageGeo> | Readonly<Record<string, StageGeo | undefined>>,
): LngLat | null {
  const own = toLngLat(meetup.latitude, meetup.longitude);
  if (own) {
    return own;
  }

  if (!meetup.stage_id) {
    return null;
  }

  const stage =
    stagesById instanceof Map
      ? stagesById.get(meetup.stage_id)
      : (stagesById as Readonly<Record<string, StageGeo | undefined>>)[meetup.stage_id];
  return getStageCoordinate(stage);
}

export function indexStagesById<T extends StageGeo>(stages: readonly T[]): Map<string, T> {
  return new Map(stages.map((stage) => [stage.id, stage]));
}

/** The next set on a stage that has not started yet; cancelled sets are skipped. */
export function getNextStageSet<T extends Pick<Set, 'stage_id' | 'start_time' | 'status'>>(stageId: string, sets: readonly T[], now: Date): T | null {
  const nowMs = now.getTime();
  return (
    [...sets]
      .filter((set) => set.stage_id === stageId && !isCancelledSet(set) && new Date(set.start_time).getTime() >= nowMs)
      .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime())[0] ?? null
  );
}
