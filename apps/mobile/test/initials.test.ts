import { describe, expect, it } from 'vitest';

import { initialsOf } from '../src/components/palette';

describe('initialsOf', () => {
  it('takes one letter from each act of a pairing and skips articles and "DJ"', () => {
    expect(initialsOf('Seth Troxler b2b Ben Sterling')).toBe('SB');
    expect(initialsOf('Peggy Gou b2b Four Tet')).toBe('PF');
    expect(initialsOf('Dom Dolla b2b KETTAMA')).toBe('DK');
    expect(initialsOf('Under Construction (FISHER & Chris Lake)')).toBe('UC');
    expect(initialsOf('The Blessed Madonna')).toBe('BM');
    expect(initialsOf('DJ Harvey')).toBe('HA');
    expect(initialsOf('Skrillex')).toBe('SK');
    expect(initialsOf('Swedish House Mafia')).toBe('SH');
    expect(initialsOf('Simon & Garfunkel')).toBe('SG');
  });

  it('never returns an empty string', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf('The')).toBe('TH');
    expect(initialsOf('   ')).toBe('?');
  });
});
