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
