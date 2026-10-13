import { colors } from '@festival/ui';

/**
 * Pastel fills from the design reference. Fill-only (labels on them use `colors.textPrimary`), never
 * text colours. Stages and avatars pick one deterministically from a stable id so colours don't shift
 * between renders or devices.
 */
export const PASTELS = [
  '#FFB3D9',
  '#B2CEFE',
  '#FDFD96',
  '#B2D8B2',
  '#FFB3B3',
  '#D1B3FF',
  '#FFD1B3',
  '#B3FFE6',
] as const;

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

/** Stable pastel for any id or name. */
export function pastelFor(key: string | null | undefined): string {
  if (!key) {
    return colors.primary;
  }
  return PASTELS[hash(key) % PASTELS.length];
}

/** Two initials for a name (see ./initials). */
export { initialsOf } from './initials';
