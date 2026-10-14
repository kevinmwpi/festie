import type { ImageCredit } from '@festival/data-access';
import { describe, expect, it } from 'vitest';

import { formatLicenseLabel, groupImageCredits, imageCreditSubtitle, licenseDeedUrl, licensesInUse } from '../src/hooks/image-credits';

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

describe('licence links', () => {
  it('links Creative Commons ids to their international deed and nothing else', () => {
    expect(licenseDeedUrl('CC-BY-SA-4.0')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(licenseDeedUrl('CC-BY-2.0')).toBe('https://creativecommons.org/licenses/by/2.0/');
    expect(licenseDeedUrl(' CC-BY-SA-3.0 ')).toBe('https://creativecommons.org/licenses/by-sa/3.0/');
    expect(licenseDeedUrl('CC0-1.0')).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    for (const id of ['public-domain', 'organizer-permission', 'press-kit-editorial', 'generated', 'CC-BY-NC-4.0', '']) {
      expect(licenseDeedUrl(id), id).toBeNull();
    }
  });

  it('lists each CC licence in use once, with its photo count, by label', () => {
    const rows = [
      credit('artist', 'A', { image_license: 'CC-BY-SA-4.0' }),
      credit('artist', 'B', { image_license: 'CC-BY-2.0' }),
      credit('festival', 'C', { image_license: 'organizer-permission' }),
      credit('artist', 'D', { image_license: 'CC-BY-SA-4.0' }),
      credit('artist', 'E', { image_license: null }),
    ];
    expect(licensesInUse(rows)).toEqual([
      { id: 'CC-BY-2.0', label: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/', count: 1 },
      { id: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', count: 2 },
    ]);
    expect(licensesInUse([credit('festival', 'C', { image_license: 'generated' })])).toEqual([]);
    expect(licensesInUse([])).toEqual([]);
  });
});
