import { describe, expect, it } from 'vitest';

import { describeSetChange, detectConflict, getConflictPairs, getNextUpcomingSet, isCancelledSet, parseSetStatus, type Set } from '../src';

const LA = 'America/Los_Angeles';

function createSet(overrides: Partial<Set>): Set {
  return {
    id: 'set-1',
    artist_id: 'artist-1',
    stage_id: 'stage-1',
    festival_id: 'festival-1',
    start_time: '2026-10-11T04:10:00.000Z',
    end_time: '2026-10-11T05:40:00.000Z',
    ...overrides,
  };
}

describe('set status', () => {
  it('reads missing and unknown statuses as scheduled', () => {
    expect(parseSetStatus(undefined)).toBe('scheduled');
    expect(parseSetStatus(null)).toBe('scheduled');
    expect(parseSetStatus('postponed')).toBe('scheduled');
    expect(parseSetStatus('moved')).toBe('moved');
    expect(isCancelledSet({ status: 'cancelled' })).toBe(true);
    expect(isCancelledSet({})).toBe(false);
  });

  it('describes nothing for a set that happens as planned', () => {
    expect(describeSetChange({ start_time: '2026-10-11T04:10:00Z' }, LA)).toBeNull();
    expect(describeSetChange({ start_time: '2026-10-11T04:10:00Z', status: 'scheduled', change_note: '  ' }, LA)).toBeNull();
  });

  it('shows the old weekday when a set moved to another festival day', () => {
    // Saturday 11:00 PM PDT moved to Sunday 9:10 PM PDT.
    const change = describeSetChange(
      {
        start_time: '2026-10-12T04:10:00Z',
        status: 'moved',
        original_start_time: '2026-10-11T06:00:00Z',
        change_note: 'Moved to Sunday after Saturday was cut short by lightning',
      },
      LA,
    );
    expect(change).toEqual({
      status: 'moved',
      label: 'Moved',
      previousTime: 'Sat 11:00 PM',
      note: 'Moved to Sunday after Saturday was cut short by lightning',
      accessibilityLabel: 'Moved, was Sat 11:00 PM. Moved to Sunday after Saturday was cut short by lightning.',
    });
  });

  it('shows only the old time when a set moved within the same festival day', () => {
    // 1:00 AM still belongs to the previous festival day.
    const change = describeSetChange(
      { start_time: '2026-10-11T06:00:00Z', status: 'moved', original_start_time: '2026-10-11T08:00:00Z' },
      LA,
    );
    expect(change?.previousTime).toBe('1:00 AM');
    expect(change?.accessibilityLabel).toBe('Moved, was 1:00 AM.');
  });

  it('labels an old after-midnight slot with its festival day, like the rest of the app', () => {
    // Sunday 1:00 AM PDT belongs to Saturday's festival day; moved to Sunday 9:10 PM.
    const change = describeSetChange(
      { start_time: '2026-10-12T04:10:00Z', status: 'moved', original_start_time: '2026-10-11T08:00:00Z' },
      LA,
    );
    expect(change?.previousTime).toBe('Sat night 1:00 AM');
  });

  it('leaves out the old time when it is unknown, unchanged or invalid', () => {
    expect(describeSetChange({ start_time: '2026-10-11T06:00:00Z', status: 'moved' }, LA)?.previousTime).toBeNull();
    expect(
      describeSetChange({ start_time: '2026-10-11T06:00:00Z', status: 'moved', original_start_time: '2026-10-11T06:00:00.000Z' }, LA)
        ?.previousTime,
    ).toBeNull();
    expect(describeSetChange({ start_time: '2026-10-11T06:00:00Z', status: 'moved', original_start_time: 'nope' }, LA)?.previousTime).toBeNull();
  });

  it('describes a cancelled set and ignores an original time on it', () => {
    expect(
      describeSetChange({ start_time: '2026-10-11T06:00:00Z', status: 'cancelled', original_start_time: '2026-10-11T04:00:00Z', change_note: 'Artist withdrew.' }, LA),
    ).toEqual({ status: 'cancelled', label: 'Cancelled', previousTime: null, note: 'Artist withdrew.', accessibilityLabel: 'Cancelled. Artist withdrew.' });
  });

  it('describes a note on a set that kept its status', () => {
    expect(describeSetChange({ start_time: '2026-10-11T06:00:00Z', change_note: 'Gates opened an hour late' }, LA)).toEqual({
      status: 'scheduled',
      label: null,
      previousTime: null,
      note: 'Gates opened an hour late',
      accessibilityLabel: 'Gates opened an hour late.',
    });
  });

  it('never reports a clash with a cancelled set', () => {
    const live = createSet({ id: 'live' });
    const cancelled = createSet({ id: 'gone', status: 'cancelled' });
    expect(detectConflict(live, createSet({ id: 'other' }))).toBe(true);
    expect(detectConflict(live, cancelled)).toBe(false);
    expect(detectConflict(cancelled, live)).toBe(false);
    expect(getConflictPairs([live, cancelled])).toEqual([]);
  });

  it('skips cancelled sets when finding the next set', () => {
    const cancelled = createSet({ id: 'gone', status: 'cancelled', start_time: '2026-10-11T03:00:00Z' });
    const next = createSet({ id: 'next', start_time: '2026-10-11T04:00:00Z' });
    expect(getNextUpcomingSet([cancelled, next], new Date('2026-10-11T02:00:00Z'))?.id).toBe('next');
  });
});
