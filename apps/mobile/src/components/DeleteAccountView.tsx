import { getStoredSession } from '@festival/data-access';
import {
  colors,
  continuous,
  DestructiveButton,
  FieldInput,
  FieldLabel,
  InlineMessage,
  layout,
  radii,
  ScreenHeader,
  SectionCard,
  showToast,
  spacing,
  textStyles,
  useOfflineStatus,
} from '@festival/ui';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { KeyboardAvoidingScreen } from '@/src/components/KeyboardAvoidingScreen';
import { getPendingCount, performSignOut, signOutErrorMessage } from '@/src/providers/session-actions';

const CONFIRM_WORD = 'DELETE';
/** Wait for the keyboard to finish opening before scrolling the confirmation into view. */
const KEYBOARD_SETTLE_MS = 300;

const DELETED = [
  'Your profile: name, avatar and email address',
  'Your crew memberships. If you are a crew’s only admin, the longest-standing member becomes admin; crews left with no members are deleted',
  'Meetups and totem photos you created',
  'Your schedule picks and followed festivals',
  'Your shared location and the people you blocked',
];

/**
 * Account deletion (§5.3, App Review 5.1.1(v)). Shared by Settings and by the sign-up gate
 * (`/auth/delete-account`), so an account that has not agreed to the terms or finished its profile can
 * still be deleted in the app.
 */
export function DeleteAccountView({ onBack, backgroundColor }: { onBack: () => void; backgroundColor: string }) {
  const offline = useOfflineStatus();
  const scrollRef = React.useRef<ScrollView>(null);
  const [confirmation, setConfirmation] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = React.useState(0);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      getPendingCount()
        .then((count) => {
          if (active) setPendingChanges(count);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, []),
  );

  const confirmed = confirmation.trim().toUpperCase() === CONFIRM_WORD;

  const handleDelete = React.useCallback(async () => {
    if (!confirmed || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      // Deletes on the server first; only then are local data, reminders and sharing cleared and the
      // app returns to sign-in. On failure nothing local is touched.
      await performSignOut('delete_account');
      showToast('Your account has been deleted.', 'success');
    } catch (deleteError) {
      const message = signOutErrorMessage(deleteError);
      if (getStoredSession() === null) {
        // The session ended during the attempt: signed out, but the deletion was not confirmed.
        showToast(`You were signed out, but your account wasn't deleted. Sign in and try again. ${message}`, 'error');
        return;
      }
      setError(message);
      setDeleting(false);
    }
  }, [confirmed, deleting]);

  return (
    <KeyboardAvoidingScreen style={[styles.screen, { backgroundColor }]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Delete account" subtitle="Permanent" onBack={onBack} />

        <SectionCard title="What gets deleted" subtitle="Deleting your Festie account permanently removes:">
          <View style={styles.list}>
            {DELETED.map((item) => (
              <View key={item} style={styles.listItem}>
                <Text style={styles.bullet} importantForAccessibility="no" accessibilityElementsHidden>
                  •
                </Text>
                <Text style={styles.listText}>{item}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            Reports you sent are kept without your name so we can finish reviewing them. You can sign up again later with
            the same email, but nothing is restored.
          </Text>
        </SectionCard>

        <View style={styles.warning} accessible accessibilityRole="alert">
          <Text style={styles.warningTitle}>This can&apos;t be undone</Text>
          {pendingChanges > 0 ? (
            <Text style={styles.warningText}>
              {pendingChanges === 1 ? '1 change hasn’t' : `${pendingChanges} changes haven’t`} synced yet and will be
              discarded.
            </Text>
          ) : null}
          {offline ? <Text style={styles.warningText}>You&apos;re offline. Deleting your account needs a connection; connect and try again.</Text> : null}
        </View>

        <View style={styles.field}>
          <FieldLabel>Type {CONFIRM_WORD} to confirm</FieldLabel>
          <FieldInput
            accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            editable={!deleting}
            maxLength={12}
            onChangeText={(value) => {
              setConfirmation(value);
              setError(null);
            }}
            // The screen shrinks above the keyboard; bring the field and the Delete button into view.
            onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), KEYBOARD_SETTLE_MS)}
            onSubmitEditing={() => void handleDelete()}
            placeholder={CONFIRM_WORD}
            returnKeyType="done"
            spellCheck={false}
            value={confirmation}
          />
        </View>

        <InlineMessage message={error} />
        <DestructiveButton
          label={deleting ? 'Deleting…' : 'Delete my account'}
          loading={deleting}
          disabled={!confirmed}
          onPress={() => void handleDelete()}
        />
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: layout.screenGutter, paddingBottom: spacing.xxxl + spacing.xl },
  list: { gap: spacing.sm, marginTop: spacing.xs },
  listItem: { flexDirection: 'row', gap: spacing.sm },
  // Decorative: `textTertiary`, and hidden from screen readers.
  bullet: { ...textStyles.subheadline, color: colors.textTertiary },
  listText: { ...textStyles.subheadline, color: colors.textPrimary, flex: 1 },
  note: { ...textStyles.footnote, color: colors.textSecondary, marginTop: spacing.sm },
  // A flat callout under the "What gets deleted" card, with the same card radius.
  warning: {
    ...continuous,
    backgroundColor: colors.destructiveBg,
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: layout.cardPadding,
  },
  warningTitle: { ...textStyles.headline, color: colors.destructive },
  warningText: { ...textStyles.footnote, color: colors.destructive },
  field: { gap: spacing.sm },
});
