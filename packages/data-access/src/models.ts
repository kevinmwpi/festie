import type { Database } from './database.types';

type PublicTables = Database['public']['Tables'];

export type ArtistRow = PublicTables['artists']['Row'];
export type FestivalArtistRow = PublicTables['festival_artists']['Row'];
export type FestivalRow = PublicTables['festivals']['Row'];
export type GroupMemberRow = PublicTables['group_members']['Row'];
export type GroupRow = PublicTables['groups']['Row'];
export type MeetupRow = PublicTables['meetups']['Row'];
export type SetRow = PublicTables['sets']['Row'];
export type StageRow = PublicTables['stages']['Row'];
/** Public profile columns only (email is never readable by clients). */
export type UserRow = PublicTables['users']['Row'];
export type LocationShareRow = PublicTables['location_shares']['Row'];
export type UserFestivalRow = PublicTables['user_festivals']['Row'];
export type UserSetSelectionRow = PublicTables['user_set_selections']['Row'];
export type UserBlockRow = PublicTables['user_blocks']['Row'];
export type ReportRow = PublicTables['reports']['Row'];

// ---- Shapes returned by the local SQLite cache -------------------------------------------------

/** A published festival as cached locally. */
export type Festival = FestivalRow;

/** Stage without the unused legacy normalized-grid columns. */
export type Stage = Omit<StageRow, 'map_x' | 'map_y'>;

export type Artist = ArtistRow;

/** One announced act of a festival (`festival_artists`, migration 014). */
export type FestivalArtist = FestivalArtistRow;

/** An announced artist whose set times the festival has not published yet. */
export interface UnscheduledArtist extends Artist {
  billing_order: number | null;
}

export type FestivalSet = SetRow;

export interface FestivalBundle {
  festival: Festival;
  stages: Stage[];
  /** Every artist of the festival: the announced lineup plus any set's artist, by name. */
  artists: Artist[];
  sets: FestivalSet[];
}

export interface FestivalLineupRow extends FestivalSet {
  artist_name: string;
  artist_image_url: string | null;
  genre: string | null;
  stage_name: string;
  stage_zone: string | null;
}

export interface LocalUserFestival {
  id: string;
  user_id: string;
  festival_id: string;
  selected_at: string;
}

/** Public profile of another user, as cached locally. */
export interface PublicUser {
  id: string;
  display_name: string;
  avatar_type: string;
  avatar_value: string;
  created_at: string | null;
}

export type Group = GroupRow;

export interface GroupMember extends GroupMemberRow {
  /** Null when the member's profile is not visible/cached. */
  user: PublicUser | null;
  /** True when the signed-in user has blocked this member (render as "Blocked user"). */
  is_blocked: boolean;
}

/** Selection row in the local cache; `pending_sync = 1` until the server accepted it. */
export interface LocalSelection extends UserSetSelectionRow {
  pending_sync: number;
  synced_at: string | null;
}

/** Meetup row in the local cache; `pending_sync = 1` until the server accepted it. */
export interface LocalMeetup {
  id: string;
  group_id: string;
  title: string;
  stage_id: string | null;
  starts_at: string;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Storage path in the private `totems` bucket; render via `getTotemSignedUrl`. */
  totem_path: string | null;
  created_by_user_id: string;
  created_at: string | null;
  updated_at: string | null;
  pending_sync: number;
  synced_at: string | null;
}
