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

/** Up to two initials from a display name ("Kevin M" → "KM"). */
/**
 * Two letters that identify a billed act: `Seth Troxler b2b Ben Sterling` → `SB`, `The Blessed
 * Madonna` → `BM`, `DJ Harvey` → `HA`, `Skrillex` → `SK`. Articles and the "DJ" prefix do not count;
 * a b2b / & / x / vs pairing takes one letter from each side.
 */
export function initialsOf(name: string | null | undefined): string {
  const cleaned = (name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const sides = cleaned.split(/\s+(?:b2b|b3b|&|x|vs\.?|and|\+)\s+/i).filter((side) => side.trim() !== '');
  const firstLetter = (text: string): string | null => {
    const words = text
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '' && !/^(the|dj|a|an)$/i.test(word));
    const word = words[0] ?? text.trim().split(/\s+/)[0];
    return word ? Array.from(word)[0] ?? null : null;
  };
  if (sides.length >= 2) {
    const letters = sides.map(firstLetter).filter((letter): letter is string => Boolean(letter)).slice(0, 2);
    if (letters.length === 2) {
      return letters.join('').toUpperCase();
    }
  }
  const words = cleaned.split(/\s+/).filter((word) => word !== '' && !/^(the|dj|a|an)$/i.test(word));
  if (words.length === 0) {
    const fallback = cleaned.split(/\s+/).filter(Boolean);
    return fallback.length === 0 ? '?' : Array.from(fallback[0]).slice(0, 2).join('').toUpperCase();
  }
  const letters = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words[1])[0]];
  return letters.join('').toUpperCase();
}
