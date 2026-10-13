import { requestEmailCode, toUserMessage } from '@festival/data-access';
import { colors, FieldInput, InlineMessage, layout, PrimaryButton, spacing, TextLink, textStyles } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandTile } from '@/src/components/BrandMark';
import { KeyboardAvoidingScreen } from '@/src/components/KeyboardAvoidingScreen';
import { WORDMARK_FONT } from '@/src/config/fonts';
import { openPrivacyPolicy, openTermsOfUse } from '@/src/providers/external-links';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EnterEmailScreen() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const trimmed = email.trim();
  const looksValid = trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(trimmed);

  const handleSubmit = React.useCallback(async () => {
    if (!looksValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await requestEmailCode(trimmed);
      router.push({ pathname: '/auth/verify-otp', params: { email: trimmed } });
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
    }
  }, [looksValid, loading, trimmed]);

  const handleHaveCode = React.useCallback(() => {
    // The code from an earlier email is still valid for a while; skip sending a new one.
    router.push({ pathname: '/auth/verify-otp', params: { email: trimmed, sent: '0' } });
  }, [trimmed]);

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {/* Brand: tile, wordmark and tagline */}
          <View style={styles.hero}>
            <BrandTile />
            <View style={styles.brand}>
              {/* The logotype. Its growth is capped so "Festie" never breaks across lines at accessibility
                  sizes; the tagline below carries the readable content. */}
              <Text style={styles.wordmark} accessibilityRole="header" maxFontSizeMultiplier={1.3}>
                Festie
              </Text>
              <Text style={styles.tagline}>Ready for the show?</Text>
            </View>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.field}>
              <FieldInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                maxLength={MAX_EMAIL_LENGTH}
                onChangeText={(value) => {
                  setEmail(value);
                  if (error) setError(null);
                }}
                onSubmitEditing={() => void handleSubmit()}
                placeholder="Email address"
                returnKeyType="send"
                textContentType="emailAddress"
                value={email}
              />
              <Text style={styles.helper}>We&apos;ll email you a sign-in code. No password needed.</Text>
            </View>
            <InlineMessage message={error} />
            {error && looksValid ? (
              <View style={styles.haveCodeRow}>
                <TextLink label="I already have a code" onPress={handleHaveCode} />
              </View>
            ) : null}
            <PrimaryButton
              disabled={!looksValid}
              loading={loading}
              label="Email me a code"
              onPress={() => void handleSubmit()}
              accentColor={colors.brand}
            />

            <Text style={styles.legalText}>
              By continuing you agree to our{' '}
              <Text style={styles.legalLink} accessibilityRole="link" onPress={openTermsOfUse}>
                Terms of Use
              </Text>{' '}
              and{' '}
              <Text style={styles.legalLink} accessibilityRole="link" onPress={openPrivacyPolicy}>
                Privacy Policy
              </Text>
              .
            </Text>
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
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.xxxl,
  },
  content: { gap: spacing.xxxl },
  hero: { alignItems: 'center', gap: spacing.xl },
  brand: { alignItems: 'center', gap: spacing.xs },
  // The Fredoka logotype is the one custom face and the one size outside `textStyles` (single weight, so
  // no fontWeight).
  wordmark: {
    color: colors.textPrimary,
    fontFamily: WORDMARK_FONT,
    fontSize: 52,
  },
  tagline: { ...textStyles.subheadline, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  form: { gap: spacing.md },
  field: { gap: spacing.sm },
  helper: { ...textStyles.footnote, color: colors.textSecondary, paddingHorizontal: spacing.xs },
  haveCodeRow: { alignItems: 'flex-start', paddingHorizontal: spacing.xs },
  // `subheadline` (15/20), the same as the terms checkbox label: the nested links cannot take hitSlop, so
  // their touch target is the 20pt line, and it matches on both screens.
  legalText: { ...textStyles.subheadline, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  // Same inline-link style as the terms checkbox: `link`, semibold, underlined.
  legalLink: { color: colors.link, fontWeight: '600', textDecorationLine: 'underline' },
});
