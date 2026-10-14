import type { ImageCredit, ImageCreditSubjectType } from '@festival/data-access';

export interface ImageCreditGroup {
  key: ImageCreditSubjectType;
  title: string;
  rows: ImageCredit[];
}

/** Photo credits grouped for the Photo credits screen: festivals first, then artists; rows keep their (by-name) order. */
export function groupImageCredits(rows: readonly ImageCredit[]): ImageCreditGroup[] {
  const groups: ImageCreditGroup[] = [
    { key: 'festival', title: 'Festivals', rows: rows.filter((row) => row.subject_type === 'festival') },
    { key: 'artist', title: 'Artists', rows: rows.filter((row) => row.subject_type === 'artist') },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

const LICENSE_LABELS: Record<string, string> = {
  'public-domain': 'Public domain',
  'organizer-permission': "Used with the organizer's permission",
  'press-kit-editorial': 'Official press kit',
  generated: 'Made for Festie',
};

/** A readable licence name for a registry licence id: `CC-BY-SA-4.0` → "CC BY-SA 4.0". */
export function formatLicenseLabel(license: string): string {
  const trimmed = license.trim();
  const known = LICENSE_LABELS[trimmed];
  if (known) {
    return known;
  }
  if (/^CC/i.test(trimmed)) {
    const parts = trimmed.split('-');
    const version = parts.length > 1 ? parts.pop() : undefined;
    return [parts[0], parts.slice(1).join('-'), version].filter(Boolean).join(' ');
  }
  return trimmed;
}

/** The attribution line under a name: the credit text, else the licence, else a generic note. */
export function imageCreditSubtitle(credit: Pick<ImageCredit, 'image_credit' | 'image_license'>): string {
  const text = credit.image_credit?.trim();
  if (text) {
    return text;
  }
  const license = credit.image_license?.trim();
  return license ? formatLicenseLabel(license) : 'Licensed photo';
}

const CC_BY_ID = /^CC-BY(-SA)?-(\d\.\d)$/;

/**
 * The creativecommons.org deed of a registry licence id (the international or unported version; the
 * pipeline refuses country versions), or `null` for ids that are not Creative Commons. Mirrors
 * `ccLicenseDeedUrl` in apps/admin-tools/src/media/types.ts.
 */
export function licenseDeedUrl(license: string): string | null {
  const id = license.trim();
  if (id === 'CC0-1.0') {
    return 'https://creativecommons.org/publicdomain/zero/1.0/';
  }
  const match = CC_BY_ID.exec(id);
  return match ? `https://creativecommons.org/licenses/by${match[1] ? '-sa' : ''}/${match[2]}/` : null;
}

export interface LicenseInUse {
  id: string;
  /** "CC BY-SA 4.0". */
  label: string;
  url: string;
  /** How many of the listed photos use it. */
  count: number;
}

/**
 * The Creative Commons licences behind the listed photos, each once with its deed and photo count, by
 * label. CC licences require a link to the licence; other ids (permissions, generated marks) have no
 * deed and are not listed.
 */
export function licensesInUse(rows: readonly Pick<ImageCredit, 'image_license'>[]): LicenseInUse[] {
  const byId = new Map<string, LicenseInUse>();
  for (const row of rows) {
    const id = row.image_license?.trim();
    const url = id ? licenseDeedUrl(id) : null;
    if (!id || !url) {
      continue;
    }
    const known = byId.get(id);
    if (known) {
      known.count += 1;
    } else {
      byId.set(id, { id, label: formatLicenseLabel(id), url, count: 1 });
    }
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}
