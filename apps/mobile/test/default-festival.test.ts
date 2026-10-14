import type { Festival } from '@festival/data-access';
import { describe, expect, it } from 'vitest';

import { orderFestivalsForList, pickDefaultFestival } from '../src/state/default-festival';

const TODAY = '2026-10-12';

function festival(id: string, endDate: string, overrides: Partial<Festival> = {}): Festival {
  return { id, name: id, start_date: endDate, end_date: endDate, status: 'published', is_demo: false, ...overrides } as Festival;
}

describe('pickDefaultFestival', () => {
  const ended = festival('head-trip', '2026-10-11');
  const upcoming = festival('countdown', '2027-01-01');
  const demo = festival('demo', '2027-06-20', { is_demo: true });

  it('prefers an upcoming demo festival over a real festival that has ended', () => {
    expect(pickDefaultFestival([ended, demo], [], TODAY)?.id).toBe('demo');
  });

  it('prefers an upcoming real festival, then followed festivals that have not ended', () => {
    expect(pickDefaultFestival([ended, upcoming, demo], [], TODAY)?.id).toBe('countdown');
    expect(pickDefaultFestival([ended, upcoming, demo], ['countdown', 'head-trip'], TODAY)?.id).toBe('countdown');
    expect(pickDefaultFestival([ended, upcoming, demo], ['head-trip'], TODAY)?.id).toBe('countdown');
  });

  it('falls back to the first tier when every festival has ended, and ignores drafts', () => {
    const endedDemo = festival('old-demo', '2025-06-20', { is_demo: true });
    expect(pickDefaultFestival([ended, endedDemo], ['head-trip'], TODAY)?.id).toBe('head-trip');
    expect(pickDefaultFestival([ended, endedDemo], [], TODAY)?.id).toBe('head-trip');
    expect(pickDefaultFestival([festival('draft', '2027-01-01', { status: 'draft' })], [], TODAY)).toBeNull();
    expect(pickDefaultFestival([], [], TODAY)).toBeNull();
  });
});

describe('orderFestivalsForList', () => {
  it('lists upcoming festivals soonest first, then ended ones most recent first, then demos', () => {
    const list = [
      festival('demo', '2027-06-20', { is_demo: true, start_date: '2027-06-18' }),
      festival('old', '2026-05-02', { start_date: '2026-05-01' }),
      festival('ultra', '2027-03-28', { start_date: '2027-03-26' }),
      festival('head-trip', '2026-10-11', { start_date: '2026-10-10' }),
      festival('countdown', '2027-01-01', { start_date: '2026-12-31' }),
      festival('today', '2026-10-12', { start_date: '2026-10-11' }),
    ];
    expect(orderFestivalsForList(list, TODAY).map((item) => item.id)).toEqual(['today', 'countdown', 'ultra', 'head-trip', 'old', 'demo']);
  });
});
