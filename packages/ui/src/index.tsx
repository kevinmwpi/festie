import { useNetInfo } from '@react-native-community/netinfo';
import React, { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { PressableScale, useReduceMotion } from './press';
import { accessibleAccent, colors, continuous, elevation, layout, motion, radii, spacing, tabularNums, textStyles } from './theme';

export {
  accessibleAccent,
  colors,
  continuous,
  deriveAccentColors,
  elevation,
  fontFamily,
  iconRadius,
  layout,
  MIN_ACCENT_LUMINANCE,
  motion,
  radii,
  rgba,
  spacing,
  tabularNums,
  textStyles,
} from './theme';
export { isReduceMotionEnabled, PressableScale, useReduceMotion, type PressableScaleProps } from './press';
export {
  BackChevron,
  Badge,
  DestructiveButton,
  IconButton,
  ListRow,
  ListSection,
  ScreenHeader,
  type BadgeProps,
  type BadgeTone,
  type DestructiveButtonProps,
  type IconButtonProps,
  type ListRowAccessory,
  type ListRowProps,
  type ScreenHeaderProps,
} from './controls';
export {
  Avatar,
  AVATAR_EMOJIS,
  AvatarPicker,
  Checkbox,
  checkboxLabelStyle,
  getInitials,
  type AvatarKind,
  type AvatarPickerProps,
  type AvatarProps,
  type CheckboxProps,
} from './identity';
export { showToast, ToastHost, type ToastTone } from './toast';

/* ─── Connectivity ──────────────────────────────────────── */

export function useOfflineStatus(): boolean {
  const info = useNetInfo();
  return info.isConnected === false || info.isInternetReachable === false;
}

export function OfflineBanner({ visible, label = 'Offline — showing cached data' }: { visible: boolean; label?: string }) {
  if (!visible) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerText}>{label}</Text>
    </View>
  );
}

/* ─── Layout ────────────────────────────────────────────── */

export function Screen({
  children,
  scroll = false,
  style,
  contentContainerStyle,
}: PropsWithChildren<{
  scroll?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
}>) {
  if (scroll) {
    return (
      <ScrollView
        style={[styles.screen, style]}
        contentContainerStyle={[styles.screenContent, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, styles.screenContent, style]}>{children}</View>;
}

/** White card on the festival wash: an optional `title2` title and `subheadline` subtitle over its content. */
export function SectionCard({ children, title, subtitle }: PropsWithChildren<{ title?: string; subtitle?: string }>) {
  return (
    <View style={styles.card}>
      {title ? (
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

/* ─── Inputs ────────────────────────────────────────────── */

/** Sentence-case label above a field (`footnote` 600). */
export function FieldLabel({ children }: PropsWithChildren) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

/** A text field. `style` is applied on top of the base field style (background, radius, padding, text). */
export function FieldInput({ style, ...props }: TextInputProps) {
  return <TextInput placeholderTextColor={colors.placeholder} {...props} style={[styles.input, style]} />;
}

/**
 * Inline error or helper text. Errors use role `alert` (announced by TalkBack) and are also announced to
 * VoiceOver when they appear, since iOS does not announce the alert role on its own.
 */
export function InlineMessage({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'muted' }) {
  useEffect(() => {
    if (message && tone === 'error' && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message, tone]);

  if (!message) return null;
  return (
    <Text
      style={tone === 'error' ? styles.errorText : styles.mutedText}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
    >
      {message}
    </Text>
  );
}

/* ─── Buttons ───────────────────────────────────────────── */

/**
 * The screen's main action: a 52pt pastel button (the festival accent when given, else the global blue)
 * with a dark `headline` label.
 */
export function PrimaryButton({
  label, onPress, disabled, loading, accentColor, accessibilityLabel,
}: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean; accentColor?: string; accessibilityLabel?: string;
}) {
  // The dark label must stay readable on any admin-entered festival accent.
  const bg = accentColor ? accessibleAccent(accentColor) : colors.primary;
  const inactive = Boolean(disabled || loading);
  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      style={[styles.button, { backgroundColor: bg }, inactive && styles.buttonDisabled]}
    >
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} size="small" />
      ) : (
        <Text style={styles.primaryButtonLabel}>{label}</Text>
      )}
    </PressableScale>
  );
}

/**
 * Tinted secondary button: a light blue fill with a `link` label (5.7:1). `disabled`, `loading` and
 * `accessibilityLabel` are optional.
 */
export function SecondaryButton({
  label, onPress, disabled, loading, accessibilityLabel,
}: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean; accessibilityLabel?: string;
}) {
  const inactive = Boolean(disabled || loading);
  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      style={[styles.button, styles.secondaryButton, inactive && styles.buttonDisabled]}
    >
      {loading ? (
        <ActivityIndicator color={colors.link} size="small" />
      ) : (
        <Text style={styles.secondaryButtonLabel}>{label}</Text>
      )}
    </PressableScale>
  );
}

const TEXT_LINK_ALIGN_SELF = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

/**
 * Inline text link (e.g. "I already have a code", "Terms of Use"), underlined in `colors.link`, sized
 * to its label, with a 44pt-tall hit area via hitSlop. It sits at the start of its column unless
 * `align` says otherwise: it sets its own `alignSelf`, so a parent's `alignItems` does not move it —
 * pass `align="center"` to centre it. Pass `role="button"` when it acts in place instead of navigating,
 * `busy` (or `disabled`) while its action runs, and `tone="destructive"` for an irreversible action.
 */
export function TextLink({
  label, onPress, accessibilityLabel, align = 'start', role = 'link', disabled = false, busy = false, tone = 'default',
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  align?: 'start' | 'center' | 'end';
  role?: 'link' | 'button';
  disabled?: boolean;
  busy?: boolean;
  tone?: 'default' | 'destructive';
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={inactive ? { disabled: inactive, busy } : undefined}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      style={({ pressed }) => [
        styles.textLink,
        { alignSelf: TEXT_LINK_ALIGN_SELF[align] },
        inactive && styles.textLinkInactive,
        pressed && styles.textLinkPressed,
      ]}
    >
      <Text style={[styles.textLinkLabel, tone === 'destructive' && styles.textLinkDestructive]}>{label}</Text>
    </Pressable>
  );
}

/* ─── Chips ─────────────────────────────────────────────── */

/**
 * Filter chip. `variant="accent"` (default) fills the selected chip with the festival accent (or the
 * global blue); `variant="ink"` fills it with the dark ink and a white label, for the primary selector on
 * a screen (the day picker). 36pt tall; `hitSlop` brings the target to 44pt, so a horizontal ScrollView
 * holding chips needs `paddingVertical: spacing.xs` on its content container to keep the slop unclipped.
 */
export function Chip({
  label, active = false, onPress, accentColor, variant = 'accent', accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  accentColor?: string;
  variant?: 'accent' | 'ink';
  accessibilityLabel?: string;
}) {
  const activeFill = variant === 'ink' ? colors.textPrimary : accentColor ? accessibleAccent(accentColor) : colors.primary;
  const chipStyle = [styles.chip, active && { backgroundColor: activeFill, borderColor: activeFill }];
  const labelStyle = [
    styles.chipLabel,
    active ? (variant === 'ink' ? styles.chipLabelOnInk : styles.chipLabelActive) : styles.chipLabelInactive,
  ];
  if (!onPress) {
    return (
      <View style={chipStyle}>
        <Text style={labelStyle}>{label}</Text>
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      style={chipStyle}
    >
      <Text style={labelStyle}>{label}</Text>
    </PressableScale>
  );
}

const SEGMENT_TRACK_INSET = 2;
/**
 * Equal-width segments are geometry that has to hold, so label growth is capped (as UISegmentedControl does)
 * and a long label shrinks to fit rather than breaking mid-word. The full label stays in each segment's
 * accessibilityLabel.
 */
const SEGMENT_LABEL_MAX_SCALE = 1.35;

/**
 * iOS-style segmented control for 2–4 mutually exclusive views: equal-width segments on a neutral track,
 * with a white thumb that slides to the selection (a fade-free jump with Reduce Motion on).
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const reduceMotion = useReduceMotion();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const position = useRef(new Animated.Value(selectedIndex)).current;

  useEffect(() => {
    if (reduceMotion) {
      position.setValue(selectedIndex);
      return;
    }
    Animated.spring(position, { toValue: selectedIndex, useNativeDriver: true, ...motion.select }).start();
  }, [position, reduceMotion, selectedIndex]);

  const segmentWidth = trackWidth > 0 ? (trackWidth - SEGMENT_TRACK_INSET * 2) / Math.max(1, options.length) : 0;

  return (
    <View style={styles.segmentTrack} onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}>
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.segmentThumb, { width: segmentWidth, transform: [{ translateX: Animated.multiply(position, segmentWidth) }] }]}
        />
      ) : null}
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            hitSlop={{ top: SEGMENT_TRACK_INSET, bottom: SEGMENT_TRACK_INSET }}
            style={({ pressed }) => [styles.segment, pressed && !active && styles.segmentPressed]}
          >
            <Text
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={SEGMENT_LABEL_MAX_SCALE}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────── */

const styles = StyleSheet.create({
  /* Banner */
  banner: { backgroundColor: colors.offlineBg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + spacing.xxs },
  bannerText: { ...textStyles.footnote, color: colors.offlineText, fontWeight: '600', textAlign: 'center' },

  /* Screen */
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { gap: spacing.md, padding: layout.screenGutter },

  /* Card */
  card: {
    ...continuous,
    ...elevation.card,
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.ms,
    padding: layout.cardPadding,
  },
  cardTitle: { ...textStyles.title2, color: colors.textPrimary },
  cardSubtitle: { ...textStyles.subheadline, color: colors.textSecondary, marginTop: -spacing.xs },

  /* Empty */
  emptyContainer: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: { ...textStyles.title3, color: colors.textPrimary, textAlign: 'center' },
  emptyDescription: { ...textStyles.subheadline, color: colors.textSecondary, textAlign: 'center' },
  emptyAction: { alignSelf: 'stretch', marginTop: spacing.sm },

  /* Inputs */
  fieldLabel: { ...textStyles.footnote, color: colors.textSecondary, fontWeight: '600' },
  input: {
    ...continuous,
    ...textStyles.body,
    backgroundColor: colors.surface,
    // Fields sit on white cards and sheets: the outline is what shows where the field is.
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.ms + spacing.xxs,
  },

  /* Error / Muted */
  errorText: { ...textStyles.footnote, color: colors.destructive },
  mutedText: { ...textStyles.footnote, color: colors.textSecondary },

  /* Buttons */
  button: {
    ...continuous,
    alignItems: 'center',
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.ms,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonLabel: { ...textStyles.headline, color: colors.textPrimary, textAlign: 'center' },
  secondaryButton: { backgroundColor: colors.tintedFill },
  secondaryButtonLabel: { ...textStyles.headline, color: colors.link, textAlign: 'center' },

  /* Text link */
  textLink: { minHeight: 20 },
  textLinkPressed: { opacity: 0.6 },
  textLinkInactive: { opacity: 0.5 },
  textLinkDestructive: { color: colors.destructive },
  textLinkLabel: { ...textStyles.subheadline, color: colors.link, fontWeight: '600', textDecorationLine: 'underline' },

  /* Chips */
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: layout.chipHeight,
    paddingHorizontal: spacing.md - spacing.xxs,
    paddingVertical: spacing.xs + spacing.xxs,
  },
  chipLabel: { ...textStyles.footnote, ...tabularNums, fontWeight: '600' },
  chipLabelActive: { color: colors.textPrimary },
  chipLabelOnInk: { color: colors.textOnInk },
  chipLabelInactive: { color: colors.textSecondary },

  /* Segmented control */
  segmentTrack: {
    ...continuous,
    backgroundColor: colors.fillStrong,
    borderRadius: radii.md,
    flexDirection: 'row',
    padding: SEGMENT_TRACK_INSET,
  },
  segmentThumb: {
    ...continuous,
    ...elevation.raised,
    // Android draws any child with elevation above its siblings whatever their order, which would hide the
    // selected label; iOS ignores `elevation` and keeps the shadow.
    elevation: 0,
    backgroundColor: colors.surface,
    borderRadius: radii.md - SEGMENT_TRACK_INSET,
    bottom: SEGMENT_TRACK_INSET,
    left: SEGMENT_TRACK_INSET,
    position: 'absolute',
    top: SEGMENT_TRACK_INSET,
  },
  segment: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget - SEGMENT_TRACK_INSET * 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  segmentPressed: { opacity: 0.6 },
  segmentLabel: { ...textStyles.footnote, color: colors.textPrimary, fontWeight: '500', textAlign: 'center' },
  segmentLabelActive: { fontWeight: '600' },
});
