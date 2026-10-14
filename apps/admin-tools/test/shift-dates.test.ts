import { describe, expect, it } from 'vitest';

import { shiftFestivalDates } from '../src/festival/shift-dates';
import type { FestivalSeed } from '../src/festival/types';
import { validateFestivalSeed } from '../src/festival/validate';
import { demoFestivalJson, realFestival } from './fixtures';

function demoSeed(): FestivalSeed {
  return validateFestivalSeed(demoFestivalJson()).seed!;
}

describe('shiftFestivalDates', () => {
  it('moves the demo festival and keeps wall-clock times', () => {
    const original = demoSeed();
    const { seed, days } = shiftFestivalDates(original, '2026-10-09');
    expect(days).toBe(daysFrom(original.festival.start_date, '2026-10-09'));
    expect(seed.festival.start_date).toBe('2026-10-09');
    expect(seed.festival.end_date).toBe('2026-10-11');
    expect(seed.sets[0].start_time.slice(11, 19)).toBe(original.sets[0].start_time.slice(11, 19));
    expect(validateFestivalSeed(seed).errors).toEqual([]);
    expect(seed.sets.map((set) => set.id)).toEqual(original.sets.map((set) => set.id));
  });

  it('keeps local times across a DST change (offset changes, clock time does not)', () => {
    const original = demoSeed(); // June, EDT (-04:00)
    const { seed } = shiftFestivalDates(original, '2027-01-15'); // January, EST (-05:00)
    const first = seed.sets.find((set) => set.id === original.sets[0].id)!;
    expect(first.start_time.slice(11)).toBe(`${original.sets[0].start_time.slice(11, 19)}-05:00`);
  });

  it('keeps cross-midnight sets on the following calendar day', () => {
    const original = demoSeed();
    const late = original.sets.find((set) => set.end_time.slice(11, 16) === '00:30')!;
    const { seed } = shiftFestivalDates(original, '2027-07-01');
    const moved = seed.sets.find((set) => set.id === late.id)!;
    expect(moved.end_time.slice(0, 16)).toBe(`${addOneDay(moved.start_time.slice(0, 10))}T00:30`);
  });

  it('shifts the original start of a moved set with the rest of the schedule', () => {
    const original = demoSeed();
    const set = original.sets[0];
    original.sets[0] = { ...set, status: 'moved', original_start_time: set.start_time };
    const { seed } = shiftFestivalDates(original, '2026-10-09');
    expect(seed.sets[0].original_start_time).toBe(seed.sets[0].start_time);
    expect(seed.sets[1].original_start_time).toBeNull();
  });

  it('refuses real festivals and invalid dates', () => {
    const real = validateFestivalSeed(realFestival()).seed!;
    expect(() => shiftFestivalDates(real, '2027-09-01')).toThrow(/only moves demo festivals/);
    expect(() => shiftFestivalDates(demoSeed(), '2027-13-01')).toThrow(/YYYY-MM-DD/);
  });
});

function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addOneDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
