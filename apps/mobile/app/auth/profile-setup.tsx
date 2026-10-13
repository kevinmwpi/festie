import { colors, InlineMessage, layout, PrimaryButton, spacing, TextLink, textStyles } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { KeyboardAvoidingScreen } from '@/src/components/KeyboardAvoidingScreen';
import { resetTo } from '@/src/providers/launch-route';
import { ProfileFields, useProfileForm } from '@/src/providers/profile-form';
import { performSignOut, signOutErrorMessage } from '@/src/providers/session-actions';
import { markTermsAccepted } from '@/src/providers/terms-acceptance';
import { TERMS_REQUIRED_MESSAGE, TermsAgreement } from '@/src/providers/terms-agreement';

export default function ProfileSetupScreen() {
  const form = useProfileForm(null);
  const [agreed, setAgreed] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  const handleSave = React.useCallback(async () => {
    if (!agreed) {
      form.setError(TERMS_REQUIRED_MESSAGE);
      return;
    }
    const saved = await form.save();
    if (saved) {
      // This account has now agreed explicitly; it is not asked again on `/auth/accept-terms`.
      markTermsAccepted();
      // The launch route continues to the join screen for a remembered invite, or into the app.
      resetTo('/');
    }
  }, [agreed, form]);

  const handleSignOut = React.useCallback(() => {
    setSigningOut(true);
    performSignOut('sign_out').catch((error: unknown) => {
      setSigningOut(false);
      form.setError(signOutErrorMessage(error));
    });
  }, [form]);

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Your profile</Text>
            <Text style={styles.subtitle}>Pick a name and avatar so your crew can spot you.</Text>
          </View>

          <ProfileFields form={form} />

          <TermsAgreement
            agreed={agreed}
            onChange={(next) => {
              setAgreed(next);
              if (next) form.setError(null);
            }}
          />

          <InlineMessage message={form.error} />
          <PrimaryButton
            disabled={!form.nameValid || !agreed}
            loading={form.saving}
            label="Let's go"
            onPress={() => void handleSave()}
          />
          <View style={styles.signOutRow}>
            <TextLink
              align="center"
              role="button"
              label={signingOut ? 'Signing out…' : 'Sign out'}
              busy={signingOut}
              onPress={signingOut ? () => undefined : handleSignOut}
            />
            <TextLink
              align="center"
              label="Delete my account"
              tone="destructive"
              onPress={signingOut ? () => undefined : () => router.push('/auth/delete-account')}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl,
  },
  content: {
    gap: spacing.lg,
  },
  header: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: { ...textStyles.title1, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...textStyles.subheadline, color: colors.textSecondary, textAlign: 'center' },
  // TextLink is 20pt tall with 12pt hitSlop above and below: 24pt apart, the touch areas don't overlap.
  signOutRow: { alignItems: 'center', gap: spacing.xl },
});
