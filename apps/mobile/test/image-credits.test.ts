import type { ImageCredit } from '@festival/data-access';
import { describe, expect, it } from 'vitest';

import { formatLicenseLabel, groupImageCredits, imageCreditSubtitle } from '../src/hooks/image-credits';

function credit(subject_type: ImageCredit['subject_type'], name: string, overrides: Partial<ImageCredit> = {}): ImageCredit {
  return {
    subject_type,
    subject_id: `${subject_type}-${name}`,
    name,
    image_url: `https://cdn.example/${subject_type}/${name}.jpg`,
    image_credit: null,
    image_license: null,
    image_source_url: null,
    ...overrides,
  };
}

describe('groupImageCredits', () => {
  it('puts festivals before artists, keeps each group in the given order and drops empty groups', () => {
    const rows = [credit('artist', 'Beta'), credit('festival', 'Zenith'), credit('artist', 'Delta')];
    expect(groupImageCredits(rows).map((group) => [group.title, group.rows.map((row) => row.name)])).toEqual([
      ['Festivals', ['Zenith']],
      ['Artists', ['Beta', 'Delta']],
    ]);
    expect(groupImageCredits([credit('artist', 'Beta')]).map((group) => group.key)).toEqual(['artist']);
    expect(groupImageCredits([])).toEqual([]);
  });
});

describe('imageCreditSubtitle', () => {
  it('prefers the credit text, then a readable licence, then a generic note', () => {
    expect(imageCreditSubtitle({ image_credit: ' Photo: Jane Doe, CC BY-SA 4.0 ', image_license: 'CC-BY-SA-4.0' })).toBe(
      'Photo: Jane Doe, CC BY-SA 4.0',
    );
    expect(imageCreditSubtitle({ image_credit: '  ', image_license: 'CC-BY-SA-4.0' })).toBe('CC BY-SA 4.0');
    expect(imageCreditSubtitle({ image_credit: null, image_license: null })).toBe('Licensed photo');
  });

  it('formats registry licence ids', () => {
    expect(formatLicenseLabel('CC0-1.0')).toBe('CC0 1.0');
    expect(formatLicenseLabel('CC-BY-4.0')).toBe('CC BY 4.0');
    expect(formatLicenseLabel('CC-BY-SA-2.5')).toBe('CC BY-SA 2.5');
    expect(formatLicenseLabel('public-domain')).toBe('Public domain');
    expect(formatLicenseLabel('press-kit-editorial')).toBe('Official press kit');
    expect(formatLicenseLabel('organizer-permission')).toBe("Used with the organizer's permission");
    expect(formatLicenseLabel('something-else')).toBe('something-else');
  });
});
