import { useNetInfo } from '@react-native-community/netinfo';
import React, { type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
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
import { accessibleAccent, colors, layout, radii, spacing } from './theme';

export {
  accessibleAccent,
  colors,
  deriveAccentColors,
  HEADING_FONT,
  layout,
  MIN_ACCENT_LUMINANCE,
  radii,
  rgba,
  spacing,
  typography,
} from './theme';
export {
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

export function SectionCard({ children, title, subtitle }: PropsWithChildren<{ title?: string; subtitle?: string }>) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
      {action}
    </View>
  );
}

/* ─── Inputs ────────────────────────────────────────────── */

export function FieldLabel({ children }: PropsWithChildren) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

/** A text field. `style` is applied on top of the base field style (background, radius, padding, text). */
export function FieldInput({ style, ...props }: TextInputProps) {
  return <TextInput placeholderTextColor={colors.placeholder} {...props} style={[styles.input, style]} />;
}

export function InlineMessage({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'muted' }) {
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

export function PrimaryButton({
  label, onPress, disabled, loading, accentColor,
}: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean; accentColor?: string;
}) {
  // The dark label must stay readable on any admin-entered festival accent.
  const bg = accentColor ? accessibleAccent(accentColor) : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: bg },
        (disabled || loading) && styles.buttonDisabled,
        pressed && { transform: [{ scale: 0.96 }], opacity: 0.9 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} size="small" />
      ) : (
        <Text style={styles.primaryButtonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * Outlined button; the label uses the accessible `colors.link` (pastel primary is border only).
 * `disabled`, `loading` and `accessibilityLabel` are optional additions.
 */
export function SecondaryButton({
  label, onPress, disabled, loading, accessibilityLabel,
}: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean; accessibilityLabel?: string;
}) {
  const inactive = Boolean(disabled || loading);
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      style={({ pressed }) => [styles.secondaryButton, inactive && styles.buttonDisabled, pressed && { opacity: 0.7 }]}
    >
      {loading ? (
        <ActivityIndicator color={colors.link} size="small" />
      ) : (
        <Text style={styles.secondaryButtonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

const TEXT_LINK_ALIGN_SELF = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

/**
 * Inline text link (e.g. "I already have a code", "Terms of Use"), underlined in `colors.link`, sized
 * to its label, with a 44pt-tall hit area via hitSlop. It sits at the start of its column unless
 * `align` says otherwise: it sets its own `alignSelf`, so a parent's `alignItems` does not move it —
 * pass `align="center"` to centre it.
 */
export function TextLink({
  label, onPress, accessibilityLabel, align = 'start',
}: {
  label: string; onPress: () => void; accessibilityLabel?: string; align?: 'start' | 'center' | 'end';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      style={({ pressed }) => [styles.textLink, { alignSelf: TEXT_LINK_ALIGN_SELF[align] }, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.textLinkLabel}>{label}</Text>
    </Pressable>
  );
}

/* ─── Chips ─────────────────────────────────────────────── */

export function Chip({
  label, active = false, onPress, accentColor,
}: {
  label: string; active?: boolean; onPress?: () => void; accentColor?: string;
}) {
  const activeBg = accentColor ? accessibleAccent(accentColor) : colors.primary;
  const content = (
    <View style={[styles.chip, active && { backgroundColor: activeBg }]}>
      <Text style={[styles.chipLabel, active ? styles.chipLabelActive : styles.chipLabelInactive]}>{label}</Text>
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmented}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ─── Styles ────────────────────────────────────────────── */

const styles = StyleSheet.create({
  /* Banner */
  banner: { backgroundColor: colors.offlineBg, paddingHorizontal: spacing.md, paddingVertical: 10 },
  bannerText: { color: colors.offlineText, fontSize: 13, fontWeight: '700', textAlign: 'center' },

  /* Screen */
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { gap: spacing.md, padding: spacing.lg },

  /* Card */
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 24,
    fontWeight: '700',
  },
  cardSubtitle: { color: colors.textSecondary, fontSize: 14 },

  /* Empty */
  emptyContainer: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.xxxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontStyle: 'italic',
    fontSize: 20,
    fontWeight: '700',
  },
  emptyDescription: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },

  /* Inputs */
  fieldLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  input: {
    backgroundColor: colors.surface,
    // Fields sit on white cards and sheets: the outline is what shows where the field is.
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  /* Error / Muted */
  errorText: { color: colors.destructive, fontSize: 13 },
  mutedText: { color: colors.textSecondary, fontSize: 13 },

  /* Primary Button */
  primaryButton: {
    alignItems: 'center',
    borderRadius: radii.md + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 4,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },

  /* Secondary Button */
  secondaryButton: {
    alignItems: 'center',
    // `inputBorder` is the one control boundary that clears 3:1 on white and on the festival tints.
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  secondaryButtonLabel: { color: colors.link, fontSize: 13, fontWeight: '700' },

  /* Text link */
  textLink: { minHeight: 20 },
  textLinkLabel: { color: colors.link, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },

  /* Chips — matches reference: inactive = white/surface, active = primary */
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.borderCard,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipLabelActive: { color: colors.textPrimary },
  chipLabelInactive: { color: colors.textSecondary },

  /* Segments */
  segmented: { flexDirection: 'row', gap: spacing.sm },
  /* Inactive segments read as faded via a translucent fill (not view opacity) so labels keep ≥ 4.5:1. */
  segment: {
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: radii.md,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
  },
  segmentActive: {
    backgroundColor: colors.primary,
    opacity: 1,
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  segmentLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2 },
  segmentLabelActive: { color: colors.textPrimary, fontWeight: '800' },
});
