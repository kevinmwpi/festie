/**
 * Media registry: the only way an image reaches the app (docs/festival-data.md §6,
 * docs/agents/festival-pipeline.md). Every entry records where the image came from and under which
 * licence it may be shown, and a human has approved it. Files live under `seed-data/media/<file>`;
 * approved entries are uploaded to the public `artwork` storage bucket at the same path by
 * `media:upload`, which also writes the subject row's image columns (migration 012).
 */

export const MEDIA_REGISTRY_VERSION = 1;

export type MediaSubjectType = 'artist' | 'festival';

/**
 * Licences the app may show. Anything else (CC BY-NC, CC BY-ND, "all rights reserved", unknown) is
 * rejected by `media:validate`: ND forbids the crop, NC forbids a commercial app.
 */
export const ALLOWED_LICENSES = [
  'CC0-1.0',
  'public-domain',
  'CC-BY-2.0',
  'CC-BY-2.5',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-2.0',
  'CC-BY-SA-2.5',
  'CC-BY-SA-3.0',
  'CC-BY-SA-4.0',
  /** Written permission from the rights holder is on file (reference it in `source.note`). */
  'organizer-permission',
  /** An official press/media kit whose terms allow editorial use; link the kit in `source.url`. */
  'press-kit-editorial',
  /** Made by us (e.g. a typographic mark); nothing to attribute. */
  'generated',
] as const;
export type LicenseId = (typeof ALLOWED_LICENSES)[number];

/** Licences whose terms require the attribution text to be shown in the app. */
export const ATTRIBUTION_REQUIRED: readonly LicenseId[] = [
  'CC-BY-2.0', 'CC-BY-2.5', 'CC-BY-3.0', 'CC-BY-4.0',
  'CC-BY-SA-2.0', 'CC-BY-SA-2.5', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0',
];

export type MediaSourceKind = 'wikimedia-commons' | 'organizer-permission' | 'press-kit' | 'generated' | 'other';

export type MediaReviewStatus = 'pending' | 'approved' | 'rejected';

export interface MediaSource {
  kind: MediaSourceKind;
  /** The file or kit page the image was taken from (for Commons: the File: page). */
  url: string | null;
  /** The page that led to it (for Commons: the Wikidata entity or the artist's Wikipedia page). */
  page_url?: string | null;
  retrieved_at: string;
  /** Free text: permission reference, kit terms, how the image was chosen. */
  note?: string | null;
}

export interface MediaLicense {
  id: LicenseId;
  url: string | null;
  /** Shown in the app's Photo credits screen, e.g. `Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons`. */
  attribution: string | null;
}

export interface MediaReview {
  status: MediaReviewStatus;
  by: string | null;
  at: string | null;
  note?: string | null;
}

export interface MediaEntry {
  subject_type: MediaSubjectType;
  /** `artists.id` or `festivals.id`. */
  subject_id: string;
  /** Display name at the time of entry (a check, not the source of truth). */
  subject_name: string;
  /** Path relative to the registry's directory, e.g. `artists/<uuid>.jpg`; also the bucket path. */
  file: string;
  sha256: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number | null;
  height: number | null;
  source: MediaSource;
  license: MediaLicense;
  review: MediaReview;
}

export interface MediaRegistry {
  version: typeof MEDIA_REGISTRY_VERSION;
  entries: MediaEntry[];
}

/** Public storage bucket (migration 013). Objects are served at `<SUPABASE_URL>/storage/v1/object/public/artwork/<file>`. */
export const ARTWORK_BUCKET = 'artwork';
export const ARTWORK_MAX_BYTES = 2 * 1024 * 1024;
/** Longest side the pipeline stores (Commons renders thumbnails server-side at this width). */
export const ARTWORK_MAX_SIDE = 512;
/** Image credit shown in the app; mirrors `artists_image_credit_check` / `festivals_image_credit_check`. */
export const IMAGE_CREDIT_MAX_LENGTH = 300;

export function artworkPublicUrl(supabaseUrl: string, file: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${ARTWORK_BUCKET}/${file}`;
}
