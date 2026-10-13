import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FESTIVAL_ZOOM,
  getFestivalBounds,
  getFestivalCamera,
  getMeetupCoordinate,
  getNextStageSet,
  getStageCoordinate,
  indexStagesById,
} from '../src';

describe('getFestivalCamera', () => {
  it('returns null without coordinates', () => {
    expect(getFestivalCamera({})).toBeNull();
    expect(getFestivalCamera({ latitude: 91, longitude: 10 })).toBeNull();
    expect(getFestivalCamera({ latitude: null, longitude: 10 })).toBeNull();
  });

  it('centres on the festival in [lng, lat] order with the default zoom', () => {
    expect(getFestivalCamera({ latitude: 40.1, longitude: -105.2 })).toEqual({ center: [-105.2, 40.1], zoom: DEFAULT_FESTIVAL_ZOOM });
    expect(getFestivalCamera({ latitude: 40.1, longitude: -105.2, default_zoom: 16.5 })?.zoom).toBe(16.5);
  });

  it('includes explicit bounds and derives a centre from them when needed', () => {
    const festival = { bounds_sw_lat: 10, bounds_sw_lng: 20, bounds_ne_lat: 12, bounds_ne_lng: 24 };
    expect(getFestivalCamera(festival)).toEqual({ center: [22, 11], zoom: DEFAULT_FESTIVAL_ZOOM, bounds: { sw: [20, 10], ne: [24, 12] } });
  });
});

describe('getFestivalBounds', () => {
  it('falls back to centre ± ~1.5 km', () => {
    const bounds = getFestivalBounds({ latitude: 0, longitude: 0 });
    expect(bounds).not.toBeNull();
    expect(bounds!.ne[1]).toBeCloseTo(1.5 / 111.32, 6);
    expect(bounds!.sw[1]).toBeCloseTo(-1.5 / 111.32, 6);
    expect(bounds!.ne[0]).toBeCloseTo(1.5 / 111.32, 6);
  });

  it('widens longitude span away from the equator', () => {
    const bounds = getFestivalBounds({ latitude: 60, longitude: 10 })!;
    expect(bounds.ne[0] - bounds.sw[0]).toBeCloseTo((2 * 1.5) / (111.32 * 0.5), 4);
  });

  it('returns null with no coordinates', () => {
    expect(getFestivalBounds({ latitude: undefined, longitude: undefined })).toBeNull();
  });
});

describe('stage and meetup coordinates', () => {
  const stages = indexStagesById([
    { id: 'main', latitude: 41.87, longitude: -87.62 },
    { id: 'nowhere', latitude: null, longitude: null },
  ]);

  it('reads stage coordinates', () => {
    expect(getStageCoordinate(stages.get('main'))).toEqual([-87.62, 41.87]);
    expect(getStageCoordinate(stages.get('nowhere'))).toBeNull();
    expect(getStageCoordinate(undefined)).toBeNull();
  });

  it('prefers the meetup pin, then the stage', () => {
    expect(getMeetupCoordinate({ latitude: 1, longitude: 2, stage_id: 'main' }, stages)).toEqual([2, 1]);
    expect(getMeetupCoordinate({ stage_id: 'main' }, stages)).toEqual([-87.62, 41.87]);
    expect(getMeetupCoordinate({ stage_id: 'main' }, { main: { id: 'main', latitude: 5, longitude: 6 } })).toEqual([6, 5]);
    expect(getMeetupCoordinate({ stage_id: 'nowhere' }, stages)).toBeNull();
    expect(getMeetupCoordinate({ stage_id: null }, stages)).toBeNull();
  });
});

describe('getNextStageSet', () => {
  it('returns the next set on the stage', () => {
    const sets = [
      { id: 'b', stage_id: 'main', start_time: '2026-08-01T22:00:00Z' },
      { id: 'a', stage_id: 'main', start_time: '2026-08-01T20:00:00Z' },
      { id: 'c', stage_id: 'other', start_time: '2026-08-01T19:00:00Z' },
    ];
    expect(getNextStageSet('main', sets, new Date('2026-08-01T19:30:00Z'))?.id).toBe('a');
    expect(getNextStageSet('main', sets, new Date('2026-08-01T23:00:00Z'))).toBeNull();
  });

  it('skips cancelled sets', () => {
    const sets = [
      { id: 'gone', stage_id: 'main', start_time: '2026-08-01T20:00:00Z', status: 'cancelled' },
      { id: 'next', stage_id: 'main', start_time: '2026-08-01T22:00:00Z', status: 'moved' },
    ];
    expect(getNextStageSet('main', sets, new Date('2026-08-01T19:30:00Z'))?.id).toBe('next');
  });
});
