import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accessibleAccent, colors, continuous, fontFamily, layout, radii, spacing, textStyles } from './theme';

/* ─── Avatar ────────────────────────────────────────────── */

/** Avatar kinds stored on a profile (`users.avatar_type`). */
export type AvatarKind = 'initials' | 'emoji' | 'color';

/** Emoji avatars offered when setting up or editing a profile. */
export const AVATAR_EMOJIS = [
  '🎧', '🪩', '🌞', '🌈', '🛼', '🦋', '🌊', '🔥', '🪐', '🍓',
  '🎸', '🎹', '🥁', '🎷', '🍒', '⚡', '🌻', '🌙', '🛸', '🍑',
] as const;

/** Up to two uppercase initials from a display name ("Sam Rivera" → "SR"); "?" when empty. */
export function getInitials(name: string | null | undefined): string {
  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || '?';
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export interface AvatarProps {
  /** Display name, used for initials and the screen-reader label. */
  name: string | null | undefined;
  avatarType?: string | null;
  avatarValue?: string | null;
  /** Edge length in points. Default 44. */
  size?: number;
  /** Defaults to "<name>'s avatar"; pass `null` to hide the avatar from screen readers. */
  accessibilityLabel?: string | null;
  /** Neutral placeholder with a dash instead of the user's avatar (e.g. a blocked user). */
  muted?: boolean;
}

/**
 * A profile picture: an emoji or initials on a pastel tile (40% corner radius, like the reference
 * avatars). `color` avatars use the stored colour as the fill (made fill-safe for dark text).
 */
export function Avatar({ name, avatarType, avatarValue, size = 44, accessibilityLabel, muted = false }: AvatarProps) {
  const value = avatarValue?.trim() ?? '';
  let glyph: string;
  let backgroundColor: string = colors.primary;
  let isEmoji = false;

  if (muted) {
    glyph = '–';
    backgroundColor = colors.inputBg;
  } else if (avatarType === 'emoji' && value) {
    glyph = value;
    isEmoji = true;
  } else if (avatarType === 'color') {
    glyph = getInitials(name);
    backgroundColor = HEX_COLOR.test(value) ? accessibleAccent(value) : colors.primary;
  } else {
    glyph = avatarType === 'initials' && value && value.length <= 3 ? value.toUpperCase() : getInitials(name);
    backgroundColor = colors.inputBg;
  }

  const label = accessibilityLabel === null ? undefined : accessibilityLabel ?? `${name?.trim() || 'Festie user'}'s avatar`;

  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: Math.round(size * 0.4), backgroundColor }]}
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? 'image' : undefined}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : undefined}
    >
      <Text
        allowFontScaling={false}
        style={[
          styles.avatarGlyph,
          isEmoji ? { fontSize: Math.round(size * 0.48) } : { fontFamily: fontFamily.rounded, fontSize: Math.round(size * 0.36), fontWeight: '700' },
          muted && styles.avatarGlyphMuted,
        ]}
      >
        {glyph}
      </Text>
    </View>
  );
}

/* ─── AvatarPicker ──────────────────────────────────────── */

export interface AvatarPickerProps {
  /** Current display name (for the initials option). */
  name: string;
  /** Selected emoji, or `null` for the initials option. */
  selectedEmoji: string | null;
  onSelectEmoji: (emoji: string | null) => void;
}

/** Emoji grid plus a "Use initials instead" option. */
export function AvatarPicker({ name, selectedEmoji, onSelectEmoji }: AvatarPickerProps) {
  const initials = getInitials(name);
  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel="Choose an avatar">
      <View style={styles.emojiGrid}>
        {AVATAR_EMOJIS.map((emoji) => {
          const selected = emoji === selectedEmoji;
          return (
            <Pressable
              key={emoji}
              onPress={() => onSelectEmoji(emoji)}
              accessibilityRole="radio"
              accessibilityLabel={`Avatar ${emoji}`}
              accessibilityState={{ selected, checked: selected }}
              style={({ pressed }) => [styles.emojiCell, selected && styles.cellSelected, pressed && styles.pressed]}
            >
              <Text style={styles.emoji} allowFontScaling={false}>
                {emoji}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={() => onSelectEmoji(null)}
        accessibilityRole="radio"
        accessibilityLabel={`Use initials instead, ${initials === '?' ? 'from your name' : initials}`}
        accessibilityState={{ selected: selectedEmoji === null, checked: selectedEmoji === null }}
        style={({ pressed }) => [styles.initialsCard, selectedEmoji === null && styles.cellSelected, pressed && styles.pressed]}
      >
        <Text style={styles.initialsLabel}>Use initials instead</Text>
        <Text style={styles.initialsValue}>{initials}</Text>
      </Pressable>
    </View>
  );
}

/* ─── Checkbox ──────────────────────────────────────────── */

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label: a string, or `Text` content (nested `Text` with `onPress` works as inline links). */
  label: React.ReactNode;
  /** Screen-reader label (required, since `label` may contain links). */
  accessibilityLabel: string;
  /** Extra screen-reader actions, e.g. to open the documents linked from the label. */
  accessibilityActions?: Array<{ name: string; label: string }>;
  onAccessibilityAction?: (actionName: string) => void;
  disabled?: boolean;
}

/** A 24pt checkbox with its label; the whole row (≥ 44pt tall) toggles it. */
export function Checkbox({
  checked,
  onChange,
  label,
  accessibilityLabel,
  accessibilityActions,
  onAccessibilityAction,
  disabled = false,
}: CheckboxProps) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={(event) => onAccessibilityAction?.(event.nativeEvent.actionName)}
      style={({ pressed }) => [styles.checkboxRow, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Ionicons name="checkmark" size={17} color={colors.textPrimary} /> : null}
      </View>
      {typeof label === 'string' ? <Text style={styles.checkboxLabel}>{label}</Text> : <View style={styles.checkboxLabelWrap}>{label}</View>}
    </Pressable>
  );
}

/** Text style for `Checkbox` labels built from nested `Text` (so they match string labels). */
export const checkboxLabelStyle = {
  ...textStyles.subheadline,
  color: colors.textPrimary,
} as const;

const styles = StyleSheet.create({
  avatar: { ...continuous, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarGlyph: { color: colors.textPrimary, textAlign: 'center' },
  avatarGlyphMuted: { color: colors.textSecondary },

  picker: { gap: spacing.md },
  // Five 18%-wide cells per row; the remaining 10% is split between them. A fixed column gap would
  // need a grid at least 400pt wide (0.9W + 4 × gap ≤ W) and wrap to four per row on every phone.
  // AVATAR_EMOJIS has a multiple of five entries, so every row is full.
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.ms },
  emojiCell: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget + 4,
    width: '18%',
  },
  cellSelected: { backgroundColor: colors.inputBg, borderColor: colors.link, borderWidth: 2 },
  emoji: { fontSize: 24 },
  initialsCard: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    minHeight: layout.minTouchTarget,
    padding: spacing.ms,
  },
  initialsLabel: { ...textStyles.footnote, color: colors.textSecondary, fontWeight: '600' },
  initialsValue: { ...textStyles.title2, color: colors.textPrimary },
  pressed: { opacity: 0.7 },

  checkboxRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.ms, minHeight: layout.minTouchTarget, paddingVertical: spacing.xs },
  checkbox: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.sm,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.link },
  checkboxLabel: { ...checkboxLabelStyle, flex: 1 },
  checkboxLabelWrap: { flex: 1 },
  disabled: { opacity: 0.5 },
});
