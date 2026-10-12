/**
 * Candidate slugs name a directory under `seed-data/candidates/` and, after promotion, the files
 * `seed-data/<slug>.json` and `seed-data/<slug>-csv/`. Lower-case words joined by single hyphens, so
 * they are safe as paths and stable in URLs: `head-trip-2026`, `riverside-sounds-2027`.
 */

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value);
}

/** Throws a readable error for anything that is not a slug (also guards against `..` in paths). */
export function assertSlug(value: string): string {
  if (!isSlug(value)) {
    throw new Error(`"${value}" is not a slug (lower-case letters, digits and single hyphens, e.g. head-trip-2026)`);
  }
  return value;
}

/**
 * Derives a slug from a festival name: strips diacritics, lower-cases, turns every run of other
 * characters into one hyphen and appends the year when given and not already there.
 * `slugify('Rock en Seine', 2027)` → `rock-en-seine-2027`. Returns '' when nothing is left.
 */
export function slugify(name: string, year?: number | string | null): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = year === undefined || year === null || year === '' ? '' : String(year).trim();
  if (!suffix || base === suffix || base.endsWith(`-${suffix}`)) {
    return base;
  }
  return base ? `${base}-${suffix}` : suffix;
}
