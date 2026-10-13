import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Festie Design System — tokens.
 *
 * The rules that go with these tokens are in docs/design-system.md. Light appearance only
 * (`userInterfaceStyle: "light"`): every contrast ratio below is for that appearance. Screen
 * backgrounds and the tab bar are tinted per festival at runtime via
 * `deriveAccentColors(festival.accent_color)`; pastel accents are fills, never text.
 */

export const colors = {
  /** Pastel blue — global CTA buttons, active chips, add/check buttons. Fill only (label it `textPrimary`). */
  primary: '#B2CEFE',
  /** Darker pressed state */
  primaryPressed: '#8FB8F8',

  /**
   * Festie's signature pink (the Coachella pastel): the brand tile on the launch, sign-in and terms screens
   * and the sign-in CTA, before any festival accent applies. Fill only; `textPrimary` on it is 7.7:1.
   */
  brand: '#FFB3D9',

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
  /**
   * Decorative glyphs only (chevrons, bullets, separators between crumbs): under 3:1 on white, so never
   * for text that carries information.
   */
  textTertiary: 'rgba(44, 51, 39, 0.45)',
  /** Text on dark fills (the ink chip): 13.0:1 on `textPrimary`. */
  textOnInk: '#FFFFFF',
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
  /** Tinted fill of secondary buttons and the "sample" badge; `link` on it is 5.7:1. */
  tintedFill: '#EAF1FF',

  /** Destructive actions and error copy: 6.57:1 on white, 5.76:1 on `destructiveBg`. */
  destructive: '#B42318',
  destructiveBg: '#FDECEC',

  /** Card and chip outlines (ink at 6%). */
  border: 'rgba(44, 51, 39, 0.06)',
  borderCard: 'rgba(44, 51, 39, 0.06)',
  /** Hairline dividers between rows (`StyleSheet.hairlineWidth`). */
  separator: 'rgba(44, 51, 39, 0.12)',

  /** Neutral fills inside cards: pressed rows, action rows, muted tiles. */
  fill: 'rgba(44, 51, 39, 0.05)',
  /** Stronger neutral fill: the segmented-control track, progress tracks. */
  fillStrong: 'rgba(44, 51, 39, 0.1)',
  /**
   * Surfaces floating over the map. Near-opaque so text keeps its contrast over any map pixel
   * (`textSecondary` 4.80:1 even over black).
   */
  overlay: 'rgba(255, 255, 255, 0.95)',
  /** Dimmed backdrop behind sheets. */
  scrim: 'rgba(20, 24, 18, 0.35)',

  /** Semantic */
  success: '#B2D8B2',           // pastel green — attending / selected
  successBg: '#E8F5E8',
  /** Text on `successBg`: 7.1:1. */
  successText: '#1F5C2E',
  warning: '#FDFD96',           // pastel yellow
  warningBg: '#FFF4D6',
  /**
   * Text and non-text marks for warnings and schedule conflicts: 6.8:1 on `warningBg`, 8.1:1 on white
   * (also ≥ 3:1 as a border on any tint).
   */
  warningText: '#7A4A00',
  info: '#B2CEFE',

  /** Input bg tint */
  inputBg: '#F0F4FF',
  /**
   * Text-field outline (WCAG 1.4.11 non-text contrast): 3.90:1 on white cards and sheets, ≥ 3.3:1 on
   * `background`, `inputBg` and the pastel festival tints. Also radio rings and checkbox borders.
   */
  inputBorder: '#7D8378',

  /** Shadow colour: the ink, not black, so depth reads soft on the pastel washes. */
  shadow: '#2C3327',

  /** Offline banner */
  offlineBg: '#ffd166',
  offlineText: '#2d1800',
} as const;

/** 4pt grid with an 8pt rhythm. `ms` (12) sits between `sm` and `md`. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  ms: 12,
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
  /** Horizontal margin of screen content. */
  screenGutter: 20,
  /** Inner padding of cards and list sections. */
  cardPadding: 20,
  /** Height of full-width buttons (primary, secondary, destructive). */
  buttonHeight: 52,
  /** Visual height of chips; `hitSlop` makes up the rest of the 44pt target. */
  chipHeight: 36,
} as const;

/**
 * Corner radii. Containers are the roundest and anything nested is tighter, so corners stay concentric
 * (inner ≈ outer − inset). Use with `continuous` for Apple's squircle curve.
 */
export const radii = {
  /** Progress tracks, grabbers, tiny indicators. */
  xs: 4,
  /** Checkboxes, small thumbnails. */
  sm: 8,
  /** Buttons, text fields, segmented controls, action rows. */
  md: 14,
  /** Tiles and media nested inside a card: photos, map previews, code blocks, stage blocks. */
  lg: 18,
  /** Toasts and floating controls. */
  xl: 22,
  /** Cards, list sections, sheets, empty and loading states. */
  card: 26,
  pill: 999,
} as const;

/** Corner radius of an app-icon-like tile of edge `size` (the iOS icon proportion, 22.37%). */
export function iconRadius(size: number): number {
  return Math.round(size * 0.2237);
}

/** Apple's continuous ("squircle") corner curve. iOS only; other platforms ignore it. */
export const continuous: ViewStyle = { borderCurve: 'continuous' };

/**
 * Elevation: one light source from above, tinted with the ink. Cards barely lift off the wash; only
 * things that float over content get a real shadow. Buttons, chips and rows are flat. Never put a shadow
 * on a view that also clips (`overflow: 'hidden'`), and never on a translucent fill.
 */
export const elevation = {
  /** Cards and list sections on the festival wash. */
  card: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  /** Small floating controls: round icon buttons, follow and add toggles, map pins. */
  raised: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  /** Surfaces over content: the tab bar, toasts, sheets, map overlays. */
  floating: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
} satisfies Record<string, ViewStyle>;

/**
 * Font families. Text is the platform system font (SF Pro on iOS). Titles use SF Pro Rounded
 * (`ui-rounded`, mapped by React Native to `UIFontDescriptorSystemDesignRounded`): a native, Dynamic
 * Type-ready system font that echoes the rounded wordmark. Android has no rounded system design and
 * falls back to the default.
 */
export const fontFamily = {
  text: undefined as string | undefined,
  rounded: Platform.select<string | undefined>({
    ios: 'ui-rounded',
    web: 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    default: undefined,
  }),
};

/**
 * Apple's text styles at the default content size. React Native scales sizes and line heights with the
 * user's text size (`allowFontScaling`, on by default). Emphasise with `fontWeight`, never a new size:
 * `{ ...textStyles.footnote, fontWeight: '600' }`. Minimum size is 11 (`caption2`). Labels are sentence case.
 */
export const textStyles = {
  largeTitle: { fontFamily: fontFamily.rounded, fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title1: { fontFamily: fontFamily.rounded, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title2: { fontFamily: fontFamily.rounded, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  title3: { fontFamily: fontFamily.rounded, fontSize: 20, lineHeight: 25, fontWeight: '600' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '400' },
} satisfies Record<string, TextStyle>;

/** Tabular (fixed-width) digits for times, counts and codes, so numbers line up. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Motion. Durations in ms; springs (RN `Animated.spring` speed/bounciness) for anything a finger
 * starts. Only `transform` and `opacity` animate, on the native driver. With Reduce Motion on
 * (`useReduceMotion`), movement becomes a fade or nothing.
 */
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
  /** Press-in: firm, no overshoot. */
  pressIn: { speed: 50, bounciness: 0 },
  /** Release: settles back with a hint of give. */
  pressOut: { speed: 24, bounciness: 4 },
  /** Selection changes (segmented-control thumb). */
  select: { speed: 20, bounciness: 2 },
  /** Scale of a pressed control. */
  pressedScale: 0.97,
  /** Scale of a pressed small control (round icon buttons, toggles): smaller things need a bit more travel. */
  pressedScaleSmall: 0.94,
  /** Opacity multiplier of a pressed control. */
  pressedOpacity: 0.85,
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
