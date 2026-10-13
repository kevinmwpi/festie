/**
 * One-time agreement to the Terms of Use and Privacy Policy for accounts that already have a profile
 * (§5.2, App Review guideline 1.2) — e.g. an existing account on a new device, or after the terms
 * version changes. New accounts agree on profile setup instead. The launch route sends signed-in users
 * here until they agree; the app's tabs stay closed until then.
 */
import { colors, InlineMessage, layout, PrimaryButton, SectionCard, spacing, TextLink, textStyles } from '@festival/ui';
import { Redirect, router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandTile } from '@/src/components/BrandMark';
import { resetTo } from '@/src/providers/launch-route';
import { performSignOut, signOutErrorMessage } from '@/src/providers/session-actions';
import { hasCurrentUserAcceptedTerms, markTermsAccepted } from '@/src/providers/terms-acceptance';
import { TERMS_REQUIRED_MESSAGE, TermsAgreement } from '@/src/providers/terms-agreement';

export default function AcceptTermsScreen() {
  const [alreadyAccepted] = React.useState(hasCurrentUserAcceptedTerms);
  const [agreed, setAgreed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  const handleContinue = React.useCallback(() => {
    if (!agreed) {
      setError(TERMS_REQUIRED_MESSAGE);
      return;
    }
    markTermsAccepted();
    // The launch route continues to the join screen for a remembered invite, or into the app.
    resetTo('/');
  }, [agreed]);

  const handleSignOut = React.useCallback(() => {
    setSigningOut(true);
    performSignOut('sign_out').catch((signOutError: unknown) => {
      setSigningOut(false);
      setError(signOutErrorMessage(signOutError));
    });
  }, []);

  if (alreadyAccepted) {
    // Opened by a link after agreeing already: nothing to do here.
    return <Redirect href="/" />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.content}>
        <BrandTile style={styles.brandTile} />

        <View style={styles.header}>
          <Text style={styles.eyebrow}>Before you head in</Text>
          <Text style={styles.title} accessibilityRole="header">
            Our Terms
          </Text>
          <Text style={styles.subtitle}>
            Festie is where crews share plans, meetups and photos. Please read and agree to our terms to continue.
          </Text>
        </View>

        <SectionCard>
          <TermsAgreement
            agreed={agreed}
            onChange={(next) => {
              setAgreed(next);
              if (next) setError(null);
            }}
          />
        </SectionCard>

        <InlineMessage message={error} />
        <PrimaryButton label="Continue" disabled={!agreed || signingOut} onPress={handleContinue} />
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.xxxl,
  },
  content: { gap: spacing.lg },
  brandTile: { alignSelf: 'center' },
  header: { alignItems: 'center', gap: spacing.sm },
  eyebrow: { ...textStyles.label, color: colors.textSecondary, textAlign: 'center' },
  // The gate's hero title, a size above title1 as in the original screen.
  title: { ...textStyles.title1, color: colors.textPrimary, fontSize: 32, lineHeight: 38, textAlign: 'center' },
  subtitle: { ...textStyles.subheadline, color: colors.textSecondary, textAlign: 'center' },
  // TextLink is 20pt tall with 12pt hitSlop above and below: 24pt apart, the touch areas don't overlap.
  signOutRow: { alignItems: 'center', gap: spacing.xl },
});
