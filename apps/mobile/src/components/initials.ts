// Pure (no React Native imports) so it is unit-testable without mocks.
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
