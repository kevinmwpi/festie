import { Ionicons } from '@expo/vector-icons';
import React, { type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from './press';
import { colors, continuous, elevation, layout, motion, radii, spacing, tabularNums, textStyles } from './theme';

/* ─── ListRow / ListSection ─────────────────────────────── */

/**
 * Trailing accessory of a pressable row: `chevron` opens another screen (the default), `external` leaves
 * the app (browser, mail, Settings), `none` acts in place (Stop sharing, Unblock).
 */
export type ListRowAccessory = 'chevron' | 'external' | 'none';

export interface ListRowProps {
  /** Primary label. */
  title: string;
  /** Optional second line under the title. */
  subtitle?: string;
  /** Optional trailing value (e.g. "On", "1.0.0 (12)"). */
  value?: string;
  /** `action` shows the value as a link-coloured verb the row performs (e.g. "Unblock"). Default `secondary`. */
  valueTone?: 'secondary' | 'action';
  /** Makes the row a button. */
  onPress?: () => void;
  /** Trailing accessory for pressable rows. Default `chevron`. */
  accessory?: ListRowAccessory;
  /** Destructive styling for the title (e.g. "Delete account"). */
  destructive?: boolean;
  /** Screen-reader label; defaults to "title, subtitle, value". */
  accessibilityLabel?: string;
  /** Screen-reader hint for pressable rows (e.g. "Opens in your browser"). */
  accessibilityHint?: string;
  /** Optional leading element (e.g. an `Avatar`); hidden from screen readers. */
  leading?: React.ReactNode;
  /** Shows a spinner instead of the accessory and blocks presses. */
  loading?: boolean;
}

const ACCESSORY_ICONS = { chevron: 'chevron-forward', external: 'open-outline' } as const;

/**
 * An inset-grouped row: `body` title, `subheadline` subtitle, trailing value and accessory. Pressable rows
 * get `accessibilityRole="button"`, a ≥ 44pt target and a full-width pressed highlight. Stack rows inside a
 * `ListSection` to get inset hairline separators.
 */
export function ListRow({
  title,
  subtitle,
  value,
  valueTone = 'secondary',
  onPress,
  accessory = 'chevron',
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
        <Text style={[styles.rowValue, valueTone === 'action' && styles.rowValueAction]} numberOfLines={2}>
          {value}
        </Text>
      ) : null}
      {loading ? (
        <ActivityIndicator color={destructive ? colors.destructive : colors.textSecondary} size="small" />
      ) : onPress && accessory !== 'none' ? (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Ionicons
            name={ACCESSORY_ICONS[accessory]}
            size={accessory === 'chevron' ? 17 : 18}
            color={colors.textTertiary}
          />
        </View>
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
 * An inset-grouped list section: a `footnote` header above a white card of `ListRow`s with inset hairline
 * separators, and optional helper copy below.
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
      {/* The shadow sits on the outer view; the inner one clips the rows' pressed highlight to the corners. */}
      <View style={styles.sectionShadow}>
        <View style={styles.sectionCard}>
          {rows.map((row, index) => (
            <View key={row.key ?? index}>
              {index > 0 ? <View style={styles.separator} /> : null}
              {row}
            </View>
          ))}
        </View>
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
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[styles.destructiveButton, inactive && styles.inactive]}
    >
      {loading ? (
        <ActivityIndicator color={colors.destructive} size="small" />
      ) : (
        <Text style={styles.destructiveLabel}>{label}</Text>
      )}
    </PressableScale>
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
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      pressedScale={motion.pressedScaleSmall}
      style={[styles.iconButton, { width: diameter, height: diameter, borderRadius: diameter / 2 }, disabled && styles.inactive]}
    >
      {typeof icon === 'string' || typeof icon === 'number' ? (
        // The glyph is sized to its fixed round button, so it does not follow the text size (like an icon).
        <Text style={[styles.iconGlyph, { fontSize: Math.round(diameter * 0.45) }]} allowFontScaling={false}>
          {icon}
        </Text>
      ) : (
        icon
      )}
    </PressableScale>
  );
}

/** The back chevron used by `ScreenHeader` and the app's `SubScreenHeader`. */
export function BackChevron() {
  // Ionicons' chevron sits slightly right of centre in its box; nudge it back optically.
  return <Ionicons name="chevron-back" size={22} color={colors.textPrimary} style={styles.backChevron} />;
}

/* ─── ScreenHeader ──────────────────────────────────────── */

export interface ScreenHeaderProps {
  /** Bold italic `title1` screen title (announced as a header). */
  title: string;
  /** Optional spaced-capitals line under the title. */
  subtitle?: string;
  /** Shows a 44×44 back button when set. */
  onBack?: () => void;
  /** Back button icon; defaults to a chevron. */
  backIcon?: React.ReactNode;
  /** Default "Back". */
  backAccessibilityLabel?: string;
  /** Optional trailing element on the back-button row (e.g. an `IconButton`). */
  right?: React.ReactNode;
}

/** In-screen header used by stack screens: optional back button, title, supporting line. */
export function ScreenHeader({ title, subtitle, onBack, backIcon, backAccessibilityLabel = 'Back', right }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {onBack || right ? (
        <View style={styles.headerTopRow}>
          {onBack ? (
            <IconButton icon={backIcon ?? <BackChevron />} accessibilityLabel={backAccessibilityLabel} onPress={onBack} />
          ) : (
            <View />
          )}
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

export type BadgeTone = 'neutral' | 'sample' | 'warning' | 'success';

/** Text/background pairs; every pair is ≥ 4.5:1. */
const BADGE_TONES: Record<BadgeTone, { backgroundColor: string; color: string }> = {
  neutral: { backgroundColor: '#ECEDEA', color: colors.textPrimary }, // 11.1:1
  sample: { backgroundColor: colors.tintedFill, color: colors.link }, // 5.7:1
  warning: { backgroundColor: colors.warningBg, color: colors.warningText }, // 6.8:1
  success: { backgroundColor: colors.successBg, color: colors.successText }, // 7.1:1
};

export interface BadgeProps {
  label: string;
  /** Default 'neutral'. Use 'sample' for demo festivals, 'warning' for schedule conflicts. */
  tone?: BadgeTone;
}

/** Small sentence-case pill label (e.g. "Sample", "Admin", "Pending", "Clashes"). */
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
    gap: spacing.ms,
    minHeight: layout.buttonHeight,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.ms,
  },
  rowPressed: { backgroundColor: colors.fill },
  rowText: { flex: 1, gap: spacing.xxs },
  rowTitle: { ...textStyles.body, color: colors.textPrimary },
  rowTitleDestructive: { color: colors.destructive },
  rowSubtitle: { ...textStyles.subheadline, color: colors.textSecondary },
  rowValue: { ...textStyles.body, color: colors.textSecondary, maxWidth: '50%', textAlign: 'right' },
  rowValueAction: { color: colors.link, fontWeight: '600' },

  section: { gap: spacing.sm },
  sectionTitle: {
    ...textStyles.footnote,
    color: colors.textSecondary,
    fontWeight: '600',
    paddingHorizontal: layout.cardPadding,
  },
  sectionShadow: { ...continuous, ...elevation.card, backgroundColor: colors.surface, borderRadius: radii.card },
  sectionCard: {
    ...continuous,
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  separator: {
    backgroundColor: colors.separator,
    height: StyleSheet.hairlineWidth,
    marginLeft: layout.cardPadding,
  },
  sectionFooter: { ...textStyles.footnote, color: colors.textSecondary, paddingHorizontal: layout.cardPadding },

  destructiveButton: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.destructiveBg,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.ms,
  },
  destructiveLabel: { ...textStyles.buttonCaps, color: colors.destructive, textAlign: 'center' },

  iconButton: {
    ...elevation.raised,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderWidth: 1,
    justifyContent: 'center',
  },
  iconGlyph: { color: colors.textPrimary, textAlign: 'center' },
  backChevron: { marginLeft: -2 },

  // Same metrics as the app's SubScreenHeader; screens using this one already pad their content by the gutter.
  header: { gap: spacing.xs, paddingBottom: spacing.sm },
  headerTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    marginLeft: -spacing.xs,
  },
  headerTitle: { ...textStyles.title1, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.label, color: colors.textSecondary },

  badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badgeLabel: { ...textStyles.caption1, ...tabularNums, fontWeight: '600' },

  inactive: { opacity: 0.5 },
});
