# Festie design system

The visual and interaction rules every Festie screen follows, on iOS and on the website. The tokens live
in [`packages/ui/src/theme.ts`](../packages/ui/src/theme.ts) and the shared primitives in
[`packages/ui/src`](../packages/ui/src); the website's copy of the same decisions lives in `SITE_CSS` in
[`docs/legal/generate.mjs`](legal/generate.mjs). Apple's Human Interface Guidelines are the authority for
anything this page does not cover.

Festie should feel like a native iOS app that happens to love festivals: system typography, calm surfaces,
precise geometry, and one bright idea per screen (the festival's own colour). Decoration that does not
help someone find a set, a friend or a meeting point does not belong.

## Principles

1. **Content first.** The festival wash, the lineup and the people are the interface. Chrome stays quiet:
   no gradients, no glass, no ornamental shadows, no all-caps shouting.
2. **One system, applied everywhere.** Every size, colour, radius, shadow and duration comes from a token.
   A literal in a screen's StyleSheet is a bug unless a comment says why.
3. **Native behaviour.** Dynamic Type, VoiceOver, Reduce Motion, 44pt targets and the system font are not
   optional extras.
4. **Preserve the product.** Navigation, information architecture, copy and button positions stay where
   people learned them. Visual changes never change behaviour.

## Typography

Body text is the system font (SF Pro). Titles use Festie's display face: **Georgia, bold italic**
(`fontFamily.display`, built into iOS), the slightly cursive titles that give the app its character. The
Fredoka wordmark appears only as the "Festie" logotype. Text that borrows a title size but is not a title
(invite codes, sign-in code digits, initials) spreads `upright` to stay in the system face.

Use the `textStyles` roles. Sizes are Apple's defaults at the standard content size; React Native scales them
(and their line heights) with the user's text size.

| Role | Size / line | Weight | Family | Use for |
|---|---|---|---|---|
| `largeTitle` | 34 / 41 | 700 italic | Georgia | Rare: a screen's single hero title |
| `title1` | 28 / 34 | 700 italic | Georgia | Pushed-screen titles (`SubScreenHeader`), auth screen titles |
| `title2` | 22 / 28 | 700 italic | Georgia | Card and sheet titles, festival and crew names |
| `title3` | 20 / 25 | 700 italic | Georgia | Artist names on cards, in-card section titles |
| `headline` | 17 / 22 | 600 | SF Pro | Row titles that need emphasis |
| `body` | 17 / 22 | 400 | SF Pro | List row titles, form fields, long text |
| `callout` | 16 / 21 | 400 | SF Pro | Secondary body copy inside cards |
| `subheadline` | 15 / 20 | 400 | SF Pro | Supporting lines, row subtitles, descriptions |
| `footnote` | 13 / 18 | 400 | SF Pro | Section headers (600), helper text, metadata, chips (600) |
| `caption1` | 12 / 16 | 400 | SF Pro | Badges (600), timestamps, dense metadata |
| `caption2` | 11 / 13 | 400 | SF Pro | Tab bar labels, timeline micro-text |
| `label` | 10 / 14 | 800, caps, +2 | SF Pro | The line under a screen title (header subtitles) |
| `buttonCaps` | 13 / 18 | 800, caps, +2 | SF Pro | Primary and destructive button labels |
| `buttonText` | 13 / 18 | 700 | SF Pro | Secondary button labels |

Rules:

- **Spaced capitals only in two places**: the line under a screen title (`label`) and primary and
  destructive button labels (`buttonCaps`); both styles uppercase through `textTransform`, so source strings
  stay sentence case. Everything else is sentence case: section headers are `footnote` 600 in
  `textSecondary`, badges `caption1` 600. Never `.toUpperCase()` a string in code.
- Change emphasis with `fontWeight` (400 / 600 / 700), never by inventing a size. 500 (Medium) appears only where
  iOS uses it natively: unselected tab-bar and segmented-control labels, and the map's small pin times.
- No `letterSpacing` except on codes (invite and sign-in codes) and the two spaced-capitals styles.
- **Times, counts and codes use tabular figures** (`...tabularNums`) so columns line up. Chip and badge
  labels have them built in.
- Minimum size is 11, except the 10pt `label` capitals under titles. Text never sits in a fixed-height box:
  use `minHeight` and let it wrap.
- `allowFontScaling={false}` only for glyphs inside fixed decorative tiles (avatars, monograms, the tab bar),
  each with a comment. Where geometry must hold (the schedule timeline), cap growth with
  `maxFontSizeMultiplier` and keep the full text in the accessibility label.

## Colour

Light appearance only (`userInterfaceStyle: "light"`): every pair below is contrast-checked for it. Dark
mode for the app is deliberately out of scope (see "Not in scope").

| Token | Value | Use |
|---|---|---|
| `background` | `#FFF5F9` | Default screen background under the festival wash |
| `surface` | `#FFFFFF` | Cards, sheets, fields |
| `textPrimary` | `#2C3327` | All primary text and labels on pastel fills (13.0:1 on white) |
| `textSecondary` | ink 70% | Secondary text (≥ 4.5:1 on white and every tint) |
| `textTertiary` | ink 45% | Decorative glyphs only (chevrons, bullets); never information |
| `link` | `#2F5DA8` | Links and secondary-button labels (6.46:1 on white) |
| `destructive` / `destructiveBg` | `#B42318` / `#FDECEC` | Destructive actions and errors |
| `primary` | `#B2CEFE` | Global CTA fill (fill only, never text) |
| `brand` | `#FFB3D9` | Festie pink: the brand tile and the sign-in CTA, before a festival accent applies |
| `tintedFill` | `#EAF1FF` | Secondary (tinted) button fill and the sample badge |
| `separator` | ink 12% | Hairline dividers |
| `border` / `borderCard` | ink 6% | Card and chip outlines |
| `fill` / `fillStrong` | ink 5% / 10% | Neutral fills: pressed rows, segmented-control track, action rows |
| `overlay` | white 95% | Small labels over the map that cast no shadow (friend names) |
| `scrim` | ink-black 35% | Backdrop behind sheets |
| `success…`, `warning…` | pastel pairs + text | Status; text always uses the `…Text` token |

- **Festival accents are the brand.** `deriveAccentColors(accent)` gives the screen wash (`bgTint`), card
  wash (`surfaceTint`), chip fill and the fill-safe `solid`. Accents are fills only; text on them is
  `textPrimary`.
- **Conflicts are a warning, not an error**: amber `warningText` / the `warning` badge everywhere a set
  clashes with another. Red (`destructive`) is reserved for destructive actions and failures.
- No hex or `rgba()` literals in screens. If a colour is missing, add a token with its contrast ratio.

## Spacing and layout

A 4pt grid with an 8pt rhythm: `xxs 2 · xs 4 · sm 8 · ms 12 · md 16 · lg 20 · xl 24 · xxl 32 · xxxl 40`.

- Screen content uses a 20pt gutter (`layout.screenGutter`). Cards and list sections pad 20
  (`layout.cardPadding`). Stacked cards are 16 apart; groups of cards 24.
- Full-width buttons are 52pt tall (`layout.buttonHeight`). Every tappable thing is at least 44×44
  (`layout.minTouchTarget`); when a control is visually smaller, use `hitSlop`, and inside a horizontal
  `ScrollView` give the content container enough vertical padding that the slop is not clipped.
- Tab screens add `useTabBarClearance()` at the bottom; nothing hides under the floating tab bar.
- Keep density where it helps: the lineup and the timeline stay compact; forms and settings breathe.

## Shape

Corners are continuous (`...continuous`, Apple's squircle curve) and concentric: a nested element's radius
is roughly its container's radius minus the inset between them.

| Token | Value | Use |
|---|---|---|
| `card` | 26 | Cards, list sections, sheets, empty and loading states |
| `xl` | 22 | Toasts and floating controls |
| `lg` | 18 | Tiles and media inside a card (photos, map previews, stage blocks) |
| `md` | 14 | Buttons, text fields, segmented controls, action rows |
| `sm` | 8 | Checkboxes, small thumbnails |
| `xs` | 4 | Progress tracks, grabbers, tiny indicators |
| `pill` | 999 | Chips, badges, the tab bar, round icon buttons |

App-icon-like tiles (the brand tile, festival swatches, artist monograms) use `iconRadius(size)` (22.37% of
the edge, the iOS icon proportion).

## Depth

One light source from above; shadows are tinted with the ink, never pure black.

- `elevation.card`: barely-there lift for cards on the wash.
- `elevation.raised`: small floating controls (round icon buttons, the follow and add toggles).
- `elevation.floating`: things that float over content: the tab bar, toasts, sheets, map overlays.
- Buttons, chips and rows are flat. Translucent surfaces get no shadow (iOS cannot path them).
- A shadow and `overflow: 'hidden'` never share a view: wrap the clipped content.
- No blur or glass: legibility comes from solid surfaces. The map's floating controls are opaque `surface`
  with `elevation.floating` (a translucent fill would force iOS to render the shadow offscreen on every
  frame while the map moves).

## Components

Use the shared primitives; do not restyle them locally.

- **Buttons** (`PrimaryButton`, `SecondaryButton`, `DestructiveButton`): 52pt, `md` radius. Primary and
  destructive labels are `buttonCaps`; secondary labels are `buttonText`. Primary is the pastel fill (festival accent when given); secondary is the tinted
  blue fill with a `link` label; destructive is `destructiveBg` with a `destructive` label. Disabled is
  50% opacity; loading swaps the label for a spinner and sets `busy`.
- **TextLink**: underlined `link`; pass `role="button"` when it performs an action instead of navigating,
  `busy`/`disabled` while that action runs, and `tone="destructive"` for an irreversible one.
- **Chip**: pill, 36pt tall, `footnote` 600. `variant="ink"` (dark fill, white label) marks the primary
  selector on a screen (the day picker); `variant="accent"` (default, festival or blue fill) marks
  secondary filters.
- **SegmentedControl**: an iOS segmented control: equal-width segments on a `fillStrong` track with a white
  sliding thumb. Use it for 2–4 mutually exclusive views.
- **ListSection / ListRow**: inset-grouped lists. `footnote` 600 section header, `body` titles, inset
  hairline separators, a full-width pressed highlight and an Ionicons chevron for navigation rows only
  (`accessory="none"` for in-place actions, `"external"` for links that leave the app). A trailing verb the
  row performs ("Unblock") uses `valueTone="action"`.
- **Headers**: tab roots keep the Fredoka wordmark over a `subheadline` breadcrumb; pushed screens use
  `SubScreenHeader` (44pt round back button, `title1` title, `label` capitals line). Screens whose content already
  has the 20pt gutter (Settings, Edit profile, Blocked users, Delete account) use `@festival/ui`'s `ScreenHeader`,
  which has the same metrics.
- **Sheets** (`BottomSheet`, `ActionSheet`): `card` top corners, a grabber, a `title2` (Georgia italic) title and a visible
  close button; the VoiceOver escape gesture closes them.
- **States**: loading (`LoadingState`), empty (`EmptyState`), error with retry (`ErrorState`), offline and
  stale-data notes exist for every data screen. Keep their copy; restyle only through the primitives.
- **Toasts**: bottom, above the tab bar (or just above the keyboard while it is open), `xl` radius,
  `floating` elevation, announced to VoiceOver.
- **Brand tile** (`BrandTile`): the Festie mark on `brand` pink with `iconRadius` corners; launch, sign-in and
  terms screens only.

## Motion

Motion explains a change or acknowledges a touch; it never decorates.

- **Press feedback** is one behaviour everywhere (`PressableScale`): on touch-down the control springs to
  97% scale and 85% opacity immediately; on release it settles back. List rows instead highlight with
  `fill`, like iOS table cells.
- **State changes** use short, native-driven transitions: `motion.fast` 140ms, `motion.base` 220ms,
  `motion.slow` 320ms. Springs have little or no overshoot. Only `transform` and `opacity` animate.
- The segmented control's thumb slides; toasts fade and rise; sheets use the native slide.
- **Reduce Motion** (`useReduceMotion()`): movement becomes a fade or nothing. Press feedback keeps its
  opacity change and drops the scale. Small controls (round icon buttons, toggles) use
  `motion.pressedScaleSmall` (94%).
- No new native dependencies (no haptics, blur or gesture libraries): OTA updates reuse the shipped binary
  (`runtimeVersion` policy `appVersion`), so a new native module would crash older installs.

## Accessibility

- Every control has a role, a label and its state (`selected`, `checked`, `disabled`, `busy`). Icon-only
  controls always have a label.
- Headings carry `accessibilityRole="header"`. Decorative glyphs and tiles are hidden from VoiceOver on both
  platforms.
- Errors are announced on iOS too (`InlineMessage` announces when it appears), and live regions are not used
  for text that ticks every few seconds.
- Text contrast is at least 4.5:1, non-text (field outlines, radio rings, conflict borders) at least 3:1.
- Keyboard: forms sit in `KeyboardAvoidingScreen`, which measures its own window position at every keyboard
  event and pads its content by the real overlap, so fields stay above the keyboard under the status bar and
  the offline banner (React Native's `KeyboardAvoidingView` measures against its parent and comes up short).

## Website

The website (privacy, terms, support and the home page; generated by `docs/legal/generate.mjs`) uses the same
decisions, translated to web conventions:

- Same ink, wash, link and card colours; a real dark theme via `prefers-color-scheme` with every pair
  checked to WCAG AA (most AAA).
- System font stack; page titles in bold italic Georgia, as in the app. On iOS the base size follows Dynamic Type
  (`font: -apple-system-body`), because the app opens these pages in a Safari sheet. Sizes are in `rem`.
- Long-form measure of about 60–75 characters, line height around 1.6, clear h2/h3 rhythm, sentence-case
  metadata, and an "On this page" index on long documents.
- Visible focus rings, 44px navigation targets, a skip link, hover and pressed states on links, print
  styles, `prefers-reduced-motion` respected. No trackers or third-party requests on any page.
- The legal and support pages use no JavaScript and no web fonts: static documents gain nothing from scripted
  motion.

### Home page

The home page is the one place where motion decorates; the Motion rules above still hold for the app and every
other page. Its styles and script live in `docs/legal/home.css` and `docs/legal/home.js`, which the generator
inlines into `index.html`.

- **The wordmark stays and the page moves around it.** The Fredoka "Festie" logotype (self-hosted from the
  app's bundled font, with its OFL licence beside it) sits high in the hero, and a ring of tiles showing what the
  app does turns below and around it. As you scroll, the ring lifts away and the wordmark holds still, then fades
  out before the next section.
- **Sections meet along a band of small squares** that follows the boundary as you scroll, about four rows
  deep: each square takes a random shade between the two sections' colours (blended in OKLCH, so the steps stay
  clear instead of turning grey), and the mix reshuffles as the edge moves, like a schedule grid filling in. The
  footer gets a straight edge. The colours are the pink wash, then the `primary` blue, `success` mint and lilac
  accents at full strength, with ink headings (at least 7:1). In dark mode the hero and footer go dark and the
  sections keep the same pastels, with ink headings and the dark cards on top.
  Links stay on the cards, because `link` on those pastels is under 4.5:1.
- **One arrival moment**: the wordmark's letters bounce in one after another and the ring settles around them.
- **A tilted tape** of what the app does scrolls across the top of the features, like a festival wristband.
- **Each feature card has a small looping motif** (the clash flag, crew faces, a dropped pin, the 1/4/8 h
  control, signal bars). Motifs and ring tiles are hidden from assistive technology; the text carries the
  meaning. With a mouse or trackpad, a card leans a few degrees toward the pointer.
- **Motion is a layer, never a requirement.** It runs only when JavaScript is on and Reduce Motion is off.
  Otherwise the page is static (solid section colours, a still ring, no fixed wordmark) with every word in
  place. Only `transform`, `opacity` and one background canvas animate. No animation libraries: CSS and about
  150 lines of plain JavaScript, so the site still has no build step.
- Ring tiles show generic examples (times, a crew code, a clash) and the screen copies use the app's fictional
  demo festival; never a real festival, artist or poster (`docs/legal/ip-review.md`).

## Not in scope (deliberately)

- **App dark mode.** The app is light-only by configuration, every style is static, and the pastel festival
  washes need their own dark interpretation. It is a separate project: semantic `ink`/`textPrimary` split,
  theme-aware styles, dark accent derivation, and a Mapbox dark style.
- **Haptics, blur materials, SF Symbols tab icons**: each needs a native module or a deliberate icon change;
  revisit with the next native build.
