import { getDb } from '@festival/sync-engine';

export type ImageCreditSubjectType = 'artist' | 'festival';

/** Attribution of one photo the app shows (an artist's or a festival's `image_url`). */
export interface ImageCredit {
  subject_type: ImageCreditSubjectType;
  /** `artists.id` or `festivals.id`. */
  subject_id: string;
  /** Artist or festival name. */
  name: string;
  /** Public https URL of the photo (the `artwork` storage bucket). */
  image_url: string;
  /** Attribution text to show, e.g. "Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons". */
  image_credit: string | null;
  /** Licence id, e.g. `CC-BY-4.0`; shown when there is no credit text. */
  image_license: string | null;
  /** Page the photo was taken from (opens from the Photo credits screen). */
  image_source_url: string | null;
}

/**
 * Every cached artist and festival photo with its attribution, ordered by name (cache only, works
 * offline). Festie shows a photo only when `image_url` is set, so this lists exactly the photos the
 * app can show from this device.
 */
export async function getLocalImageCredits(): Promise<ImageCredit[]> {
  const db = await getDb();
  return db.getAllAsync<ImageCredit>(
    `SELECT 'artist' AS subject_type, id AS subject_id, name, image_url, image_credit, image_license, image_source_url
     FROM artists WHERE image_url IS NOT NULL AND image_url <> ''
     UNION ALL
     SELECT 'festival' AS subject_type, id AS subject_id, name, image_url, image_credit, image_license, image_source_url
     FROM festivals WHERE image_url IS NOT NULL AND image_url <> ''
     ORDER BY name COLLATE NOCASE ASC, subject_type ASC, subject_id ASC;`,
  );
}
