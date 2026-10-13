/**
 * State and save logic shared by profile setup (`app/auth/profile-setup.tsx`) and profile editing
 * (`app/settings/profile.tsx`): display name (1–40 characters) and avatar (emoji or initials), plus
 * the shared form fields.
 */
import {
  DISPLAY_NAME_MAX_LENGTH,
  saveMyProfile,
  textLength,
  toUserMessage,
  type CachedProfile,
  type ProfileInput,
} from '@festival/data-access';
import {
  Avatar,
  AVATAR_EMOJIS,
  AvatarPicker,
  colors,
  FieldInput,
  FieldLabel,
  getInitials,
  spacing,
  tabularNums,
  textStyles,
} from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { queryClient } from './query-client';
import { notifyProfileChanged } from './session-state';

export { DISPLAY_NAME_MAX_LENGTH };

const DEFAULT_EMOJI: string = AVATAR_EMOJIS[0];

export interface ProfileFormState {
  displayName: string;
  setDisplayName: (value: string) => void;
  /** Selected emoji, or `null` for initials. */
  selectedEmoji: string | null;
  setSelectedEmoji: (emoji: string | null) => void;
  /** Avatar as it would be saved, for the preview. */
  preview: { avatarType: string; avatarValue: string };
  nameLength: number;
  nameTooLong: boolean;
  /** Name is valid (1–40 characters after trimming). */
  nameValid: boolean;
  /** Something differs from the initial profile (always true for a new profile). */
  dirty: boolean;
  saving: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  /** Saves (online). Resolves the saved profile, or `null` after showing an error. */
  save: () => Promise<CachedProfile | null>;
}

export function useProfileForm(initial: CachedProfile | null): ProfileFormState {
  const [displayName, setDisplayNameState] = React.useState(initial?.display_name ?? '');
  const [selectedEmoji, setSelectedEmojiState] = React.useState<string | null>(() => {
    if (!initial) return DEFAULT_EMOJI;
    return initial.avatar_type === 'emoji' && initial.avatar_value ? initial.avatar_value : null;
  });
  const [avatarTouched, setAvatarTouched] = React.useState(initial === null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmed = displayName.trim();
  const nameLength = textLength(trimmed);
  const nameTooLong = nameLength > DISPLAY_NAME_MAX_LENGTH;
  const nameValid = nameLength >= 1 && !nameTooLong;

  const avatar = React.useMemo((): Pick<ProfileInput, 'avatar_type' | 'avatar_value'> => {
    if (!avatarTouched && initial && initial.avatar_type !== 'initials') {
      // Untouched emoji/colour avatars are kept exactly as they are.
      return { avatar_type: initial.avatar_type, avatar_value: initial.avatar_value };
    }
    return selectedEmoji
      ? { avatar_type: 'emoji', avatar_value: selectedEmoji }
      : { avatar_type: 'initials', avatar_value: getInitials(trimmed) === '?' ? '' : getInitials(trimmed) };
  }, [avatarTouched, initial, selectedEmoji, trimmed]);

  const dirty =
    initial === null ||
    trimmed !== initial.display_name ||
    avatar.avatar_type !== initial.avatar_type ||
    avatar.avatar_value !== initial.avatar_value;

  const setDisplayName = React.useCallback((value: string) => {
    setDisplayNameState(value);
    setError(null);
  }, []);

  const setSelectedEmoji = React.useCallback((emoji: string | null) => {
    setSelectedEmojiState(emoji);
    setAvatarTouched(true);
    setError(null);
  }, []);

  const save = React.useCallback(async (): Promise<CachedProfile | null> => {
    if (!nameValid) {
      setError(
        nameTooLong ? `Display names can be at most ${DISPLAY_NAME_MAX_LENGTH} characters.` : 'Enter a display name.',
      );
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMyProfile({ display_name: trimmed, ...avatar });
      notifyProfileChanged();
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      return saved;
    } catch (saveError) {
      setError(toUserMessage(saveError));
      return null;
    } finally {
      setSaving(false);
    }
  }, [avatar, nameTooLong, nameValid, trimmed]);

  return {
    displayName,
    setDisplayName,
    selectedEmoji,
    setSelectedEmoji,
    preview: { avatarType: avatar.avatar_type, avatarValue: avatar.avatar_value },
    nameLength,
    nameTooLong,
    nameValid,
    dirty,
    saving,
    error,
    setError,
    save,
  };
}

/* ─── Fields ────────────────────────────────────────────── */

/** Name field with a character counter, avatar preview and avatar picker. */
export function ProfileFields({ form }: { form: ProfileFormState }) {
  return (
    <View style={styles.fields}>
      <View style={styles.avatarPreview}>
        <Avatar name={form.displayName} avatarType={form.preview.avatarType} avatarValue={form.preview.avatarValue} size={88} />
      </View>

      <View style={styles.field}>
        {/* Wraps at large text sizes so the counter is never pushed off the row. */}
        <View style={styles.labelRow}>
          {/* The field below carries the same accessibility label, so the visible label is not read twice. */}
          <View style={styles.label} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <FieldLabel>Display name</FieldLabel>
          </View>
          <Text style={[styles.counter, form.nameTooLong && styles.counterOver]} accessibilityLabel={`${form.nameLength} of ${DISPLAY_NAME_MAX_LENGTH} characters`}>
            {form.nameLength}/{DISPLAY_NAME_MAX_LENGTH}
          </Text>
        </View>
        <FieldInput
          accessibilityLabel="Display name"
          accessibilityHint="Shown to members of your crews"
          autoCapitalize="words"
          autoComplete="name"
          autoCorrect={false}
          maxLength={DISPLAY_NAME_MAX_LENGTH * 2}
          onChangeText={form.setDisplayName}
          placeholder="Festival alias"
          returnKeyType="done"
          textContentType="nickname"
          value={form.displayName}
        />
        <Text style={styles.hint}>Your crew sees this name and avatar. Don&apos;t use your email or phone number.</Text>
      </View>

      <View style={styles.field}>
        <FieldLabel>Choose avatar</FieldLabel>
        <AvatarPicker name={form.displayName} selectedEmoji={form.selectedEmoji} onSelectEmoji={form.setSelectedEmoji} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.lg },
  avatarPreview: { alignItems: 'center' },
  field: { gap: spacing.sm },
  labelRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  label: { flexShrink: 1 },
  counter: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary },
  counterOver: { color: colors.destructive },
  hint: { ...textStyles.footnote, color: colors.textSecondary, paddingHorizontal: spacing.xs },
});
