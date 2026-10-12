import { describe, expect, it } from 'vitest';

import { describeLineupAvailability, formatArtistCount } from '../src/lineup';

describe('describeLineupAvailability', () => {
  it('tells an unannounced lineup from one whose set times are still to come', () => {
    expect(describeLineupAvailability({ setCount: 0, unscheduledCount: 0 })).toBe('empty');
    expect(describeLineupAvailability({ setCount: 0, unscheduledCount: 1 })).toBe('tba');
  });

  it('tells a partially timed lineup from a fully scheduled one', () => {
    expect(describeLineupAvailability({ setCount: 3, unscheduledCount: 2 })).toBe('partial');
    expect(describeLineupAvailability({ setCount: 3, unscheduledCount: 0 })).toBe('scheduled');
  });

  it('counts artists in plain words', () => {
    expect(formatArtistCount(1)).toBe('1 artist');
    expect(formatArtistCount(12)).toBe('12 artists');
  });
});
