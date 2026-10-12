import { Platform } from 'react-native';

/**
 * Festie Design System — Theme Tokens
 *
 * Matches the AI Studio prototype palette exactly.
 * Primary = pastel blue #B2CEFE (global CTA).
 * Screen backgrounds and tab bar tint are driven per-festival
 * via deriveAccentColors(festival.accent_color).
 */

export const colors = {
  /** Pastel blue — global CTA buttons, active chips, add/check buttons */
  primary: '#B2CEFE',
  /** Darker pressed state */
  primaryPressed: '#8FB8F8',

  /** Default background (Coachella soft pink — overridden per festival at runtime) */
  background: '#FFF5F9',
  /** Card / surface white */
  surface: '#FFFFFF',

  /** Text — dark forest-green, matches reference #2C3327 */
  textPrimary: '#2C3327',
  /**
   * Secondary text. Alpha 0.7 keeps ≥ 4.5:1 on white (5.07:1), on every pastel
   * `deriveAccentColors(accent).bgTint` / `surfaceTint` (worst case 4.73:1) and on any
   * admin-entered accent once `accessibleAccent` has lifted it (worst case 4.54:1).
   */
  textSecondary: 'rgba(44, 51, 39, 0.7)',
  /** TextInput placeholder — same contrast floor as secondary text. */
  placeholder: 'rgba(44, 51, 39, 0.7)',
  textOnPrimary: '#2C3327',   // reference buttons use dark text on pastel bg
  textOnAccent: '#2C3327',

  /**
   * Text links and secondary-button labels. Pastel `primary` and festival accents are
   * fill-only and never used as text. Contrast: 6.46:1 on white, ≥ 5.70:1 on any pastel
   * accent `bgTint`/`surfaceTint`, ≥ 5.2:1 on any accent tint after `accessibleAccent`.
   */
  link: '#2F5DA8',
  linkPressed: '#244A87',

  /** Destructive actions and error copy: 6.57:1 on white, 5.76:1 on `destructiveBg`. */
  destructive: '#B42318',
  destructiveBg: '#FDECEC',

  /** Borders */
  border: 'rgba(0, 0, 0, 0.05)',
  borderCard: 'rgba(0, 0, 0, 0.05)',

  /** Semantic */
  success: '#B2D8B2',           // pastel green — attending / selected
  successBg: '#E8F5E8',
  warning: '#FDFD96',           // pastel yellow
  warningBg: '#FEFEE8',
  conflict: '#FFB3B3',          // pastel red
  conflictBg: '#FFF5F5',
  info: '#B2CEFE',

  /** Input bg tint */
  inputBg: '#F0F4FF',
  /**
   * Text-field outline (WCAG 1.4.11 non-text contrast): 3.90:1 on white cards and sheets, ≥ 3.3:1 on
   * `background`, `inputBg` and the pastel festival tints.
   */
  inputBorder: '#7D8378',

  /** Shadows */
  shadow: 'rgba(0, 0, 0, 0.06)',

  /** Offline banner */
  offlineBg: '#ffd166',
  offlineText: '#2d1800',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

/** Layout constants shared by every screen. */
export const layout = {
  /** Bottom padding every scrollable screen under (tabs) adds so content clears the floating tab bar. */
  tabBarClearance: 120,
  /** Minimum touch target (Apple HIG / Material): every tappable control is at least 44×44. */
  minTouchTarget: 44,
} as const;

export const radii = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  /** 40px — the reference's dominant card radius */
  card: 40,
  pill: 999,
} as const;

/**
 * Typography tokens.
 * Georgia is iOS-only; Android has no Georgia and would fall back to Roboto, so it gets the system
 * serif (Noto Serif) until a serif italic is bundled next to Fredoka. Screens that hard-code
 * 'Georgia' should move to `typography.heading`.
 */
export const HEADING_FONT: string | undefined = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

export const typography = {
  heading: {
    fontFamily: HEADING_FONT,
    fontStyle: 'italic' as const,
    fontWeight: '700' as const,
  },
  body: {
    fontFamily: undefined as string | undefined,
    fontWeight: '400' as const,
  },
  label: {
    fontFamily: undefined as string | undefined,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 2,
    fontSize: 10,
  },
  display: {
    fontFamily: undefined as string | undefined,
    fontWeight: '700' as const,
  },
} as const;

/* ─── Festival accent utilities ─────────────────────────── */

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return [178, 206, 254]; // #B2CEFE fallback
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** WCAG 2.x relative luminance of an sRGB colour (0 = black, 1 = white). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function mixTowardWhite(rgb: [number, number, number], amount: number): [number, number, number] {
  return rgb.map((channel) => Math.round(channel + (255 - channel) * amount)) as [number, number, number];
}

/**
 * Lowest relative luminance a festival accent may have. Every pastel accent in the design (#B2CEFE,
 * #FFB3D9, #FFD6A5, #C8B6FF, …) is above it (≥ 0.53), so they are used unchanged. At this floor, for
 * any hue: `textPrimary` on `solid` ≥ 6.8:1, `colors.link` ≥ 5.2:1 and `textSecondary` ≥ 4.5:1 on
 * `bgTint` / `surfaceTint` / `chipBg` (also stacked: a tinted card on a tinted screen).
 */
export const MIN_ACCENT_LUMINANCE = 0.5;

/**
 * Returns a fill-safe version of a festival `accent_color`. `festival.accent_color` is free-form admin
 * input, so a saturated or dark brand colour is mixed toward white (keeping its hue) just enough to
 * reach `MIN_ACCENT_LUMINANCE`; pastel accents come back unchanged (upper-cased). Invalid input falls
 * back to `colors.primary`. Idempotent.
 */
export function accessibleAccent(accentHex: string): string {
  const rgb = parseHex(accentHex);
  if (relativeLuminance(rgb) >= MIN_ACCENT_LUMINANCE) {
    return toHex(rgb);
  }
  // Luminance grows monotonically with the white mix: bisect for the smallest sufficient amount.
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step += 1) {
    const middle = (low + high) / 2;
    if (relativeLuminance(mixTowardWhite(rgb, middle)) >= MIN_ACCENT_LUMINANCE) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return toHex(mixTowardWhite(rgb, high));
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Derive soft tints from a festival's accent_color for festival-aware screens. The accent is first
 * passed through `accessibleAccent`, so the contrast guarantees above hold for any admin-entered colour.
 *
 * bgTint  → very soft screen background (replaces global colors.background)
 * solid   → the (fill-safe) accent itself (for tab bar, icon boxes, CTA buttons; label with `textPrimary`)
 * shadow  → drop shadow colour matching the accent
 *
 * Accents are pastel and fill-only: never use `solid` as a text colour. `text` is kept for
 * backward compatibility and resolves to the accessible `colors.link`.
 */
export function deriveAccentColors(accentHex: string) {
  const accent = accessibleAccent(accentHex);
  return {
    /** ~5% opacity screen background */
    bgTint: rgba(accent, 0.07),
    /** Card wash */
    surfaceTint: rgba(accent, 0.12),
    /** Active chip fill */
    chipBg: rgba(accent, 0.18),
    solid: accent,
    shadow: rgba(accent, 0.2),
    /** Readable text colour on any accent tint (accents themselves are never text). */
    text: colors.link,
  };
}
