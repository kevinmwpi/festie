import React, { type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radii, spacing } from './theme';

/* ─── ListRow / ListSection ─────────────────────────────── */

export interface ListRowProps {
  /** Primary label. */
  title: string;
  /** Optional second line under the title. */
  subtitle?: string;
  /** Optional trailing value (e.g. "On", "1.0.0 (12)"). */
  value?: string;
  /** Makes the row a button and shows a trailing chevron. */
  onPress?: () => void;
  /** Destructive styling for the title (e.g. "Delete account"). */
  destructive?: boolean;
  /** Screen-reader label; defaults to "title, subtitle, value". */
  accessibilityLabel?: string;
  /** Screen-reader hint for pressable rows (e.g. "Opens in your browser"). */
  accessibilityHint?: string;
  /** Optional leading element (e.g. an `Avatar`); hidden from screen readers. */
  leading?: React.ReactNode;
  /** Shows a spinner instead of the chevron and blocks presses. */
  loading?: boolean;
}

/**
 * A settings-style row. Pressable rows get `accessibilityRole="button"`, a ≥ 44pt touch target
 * and a trailing chevron. Stack rows inside a `ListSection` to get hairline dividers.
 */
export function ListRow({
  title,
  subtitle,
  value,
  onPress,
  destructive = false,
  accessibilityLabel,
  accessibilityHint,
  leading,
  loading = false,
}: ListRowProps) {
  const label = accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ');
  const content = (
    <>
      {leading ? (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {leading}
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, destructive && styles.rowTitleDestructive]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {loading ? (
        <ActivityIndicator color={destructive ? colors.destructive : colors.textSecondary} size="small" />
      ) : onPress ? (
        <Text style={styles.rowChevron} importantForAccessibility="no" accessibilityElementsHidden>
          ›
        </Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: loading, disabled: loading }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

/**
 * A white 40px-radius card that stacks `ListRow`s with hairline dividers, with an optional
 * uppercase micro-label above and helper copy below.
 */
export function ListSection({ title, footer, children }: PropsWithChildren<{ title?: string; footer?: string }>) {
  const rows = React.Children.toArray(children).filter(React.isValidElement);
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={styles.sectionCard}>
        {rows.map((row, index) => (
          <View key={row.key ?? index} style={index > 0 ? styles.divider : undefined}>
            {row}
          </View>
        ))}
      </View>
      {footer ? <Text style={styles.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

/* ─── DestructiveButton ─────────────────────────────────── */

export interface DestructiveButtonProps {
  label: string;
  onPress: () => void;
  /** Shows a spinner and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
}

/** Full-width button for irreversible actions (sign out, delete account, leave crew). */
export function DestructiveButton({ label, onPress, loading = false, disabled = false }: DestructiveButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.destructiveButton,
        inactive && styles.inactive,
        pressed && styles.pressedScale,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.destructive} size="small" />
      ) : (
        <Text style={styles.destructiveLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

/* ─── IconButton ────────────────────────────────────────── */

export interface IconButtonProps {
  /** An icon element, or a string (emoji / glyph) rendered as text. */
  icon: React.ReactNode;
  /** Required: icon-only controls must be named for VoiceOver/TalkBack. */
  accessibilityLabel: string;
  onPress: () => void;
  /** Diameter in points; never smaller than 44. Default 44. */
  size?: number;
  disabled?: boolean;
  accessibilityHint?: string;
}

/** Round icon-only button with a guaranteed 44×44 touch target. */
export function IconButton({ icon, accessibilityLabel, onPress, size = layout.minTouchTarget, disabled = false, accessibilityHint }: IconButtonProps) {
  const diameter = Math.max(layout.minTouchTarget, size);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.iconButton,
        { width: diameter, height: diameter, borderRadius: diameter / 2 },
        disabled && styles.inactive,
        pressed && styles.pressedScale,
      ]}
    >
      {typeof icon === 'string' || typeof icon === 'number' ? (
        <Text style={[styles.iconGlyph, { fontSize: Math.round(diameter * 0.45) }]} allowFontScaling={false}>
          {icon}
        </Text>
      ) : (
        icon
      )}
    </Pressable>
  );
}

/* ─── ScreenHeader ──────────────────────────────────────── */

export interface ScreenHeaderProps {
  /** Georgia-italic screen title (announced as a header). */
  title: string;
  /** Optional uppercase micro-label under the title. */
  subtitle?: string;
  /** Shows a 44×44 back button when set. */
  onBack?: () => void;
  /** Back button icon; defaults to a chevron glyph. */
  backIcon?: React.ReactNode;
  /** Default "Back". */
  backAccessibilityLabel?: string;
  /** Optional trailing element on the back-button row (e.g. an `IconButton`). */
  right?: React.ReactNode;
}

/** In-screen header used by stack screens: optional back button, title, micro-label. */
export function ScreenHeader({ title, subtitle, onBack, backIcon = '‹', backAccessibilityLabel = 'Back', right }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {onBack || right ? (
        <View style={styles.headerTopRow}>
          {onBack ? <IconButton icon={backIcon} accessibilityLabel={backAccessibilityLabel} onPress={onBack} /> : <View />}
          {right ?? null}
        </View>
      ) : null}
      <Text style={styles.headerTitle} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/* ─── Badge ─────────────────────────────────────────────── */

export type BadgeTone = 'neutral' | 'sample' | 'info' | 'warning' | 'success' | 'danger';

/** Text/background pairs; every pair is ≥ 4.5:1. */
const BADGE_TONES: Record<BadgeTone, { backgroundColor: string; color: string }> = {
  neutral: { backgroundColor: '#ECEDEA', color: colors.textPrimary }, // 11.1:1
  sample: { backgroundColor: '#EAF1FF', color: colors.link }, // 5.7:1
  info: { backgroundColor: '#EAF1FF', color: colors.link }, // 5.7:1
  warning: { backgroundColor: '#FFF4D6', color: '#7A4A00' }, // 6.8:1
  success: { backgroundColor: colors.successBg, color: '#1F5C2E' }, // 7.1:1
  danger: { backgroundColor: colors.destructiveBg, color: colors.destructive }, // 5.76:1
};

export interface BadgeProps {
  label: string;
  /** Default 'neutral'. Use 'sample' for demo festivals. */
  tone?: BadgeTone;
}

/** Small uppercase pill label (e.g. "Sample", "Admin", "Pending"). */
export function Badge({ label, tone = 'neutral' }: BadgeProps) {
  const palette = BADGE_TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.backgroundColor }]}>
      <Text style={[styles.badgeLabel, { color: palette.color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────── */

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm + 4,
    minHeight: 56,
    paddingVertical: spacing.sm + 6,
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  rowTitleDestructive: { color: colors.destructive },
  rowSubtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  rowValue: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', maxWidth: '50%' },
  rowChevron: { color: colors.textSecondary, fontSize: 24, fontWeight: '300', marginTop: -2 },

  section: { gap: spacing.sm },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    paddingHorizontal: spacing.md,
    textTransform: 'uppercase',
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  divider: { borderTopColor: 'rgba(44, 51, 39, 0.08)', borderTopWidth: StyleSheet.hairlineWidth },
  sectionFooter: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, paddingHorizontal: spacing.md },

  destructiveButton: {
    alignItems: 'center',
    backgroundColor: colors.destructiveBg,
    borderColor: 'rgba(180, 35, 24, 0.18)',
    borderRadius: radii.md + 4,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 4,
  },
  destructiveLabel: {
    color: colors.destructive,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderWidth: 1,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  iconGlyph: { color: colors.textPrimary, textAlign: 'center' },

  header: { gap: spacing.xs, paddingBottom: spacing.sm, paddingHorizontal: spacing.xs },
  headerTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontSize: 28,
    fontStyle: 'italic',
    fontWeight: '700',
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  badgeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },

  inactive: { opacity: 0.5 },
  pressedScale: { opacity: 0.9, transform: [{ scale: 0.96 }] },
});
