import { requestEmailCode, toUserMessage } from '@festival/data-access';
import { colors, FieldInput, InlineMessage, PrimaryButton, spacing, TextLink } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/src/components/BrandMark';
import { WORDMARK_FONT } from '@/src/config/fonts';
import { openPrivacyPolicy, openTermsOfUse } from '@/src/providers/external-links';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Default auth screen uses Coachella palette before a festival is chosen */
const AUTH_BG     = '#FFF5F9';
const AUTH_ACCENT = '#FFB3D9';

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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          {/* Icon */}
          <View style={styles.iconWrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={[styles.iconBox, { backgroundColor: AUTH_ACCENT }]}>
              <BrandMark />
            </View>
          </View>

          {/* Wordmark */}
          <View style={styles.brand}>
            <Text style={styles.wordmark} accessibilityRole="header">Festie</Text>
            <Text style={styles.tagline}>Ready for the show?</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
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
              placeholder="Email Address"
              returnKeyType="send"
              textContentType="emailAddress"
              value={email}
              style={styles.emailInput}
            />
            <Text style={styles.helper}>We&apos;ll email you a sign-in code. No password needed.</Text>
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
              accentColor={AUTH_ACCENT}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AUTH_BG,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  content: { gap: spacing.xxxl },
  iconWrap: { alignItems: 'center' },
  iconBox: {
    width: 80,
    height: 80,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  brand: { alignItems: 'center', gap: spacing.xs, marginTop: -spacing.md },
  wordmark: {
    fontFamily: WORDMARK_FONT,
    fontSize: 52,
    color: colors.textPrimary,
  },
  tagline: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  form: { gap: spacing.md },
  emailInput: { paddingVertical: 20, fontSize: 16 },
  helper: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: -spacing.xs, paddingHorizontal: spacing.xs },
  haveCodeRow: { alignItems: 'flex-start', paddingHorizontal: spacing.xs },
  legalText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.xs, textAlign: 'center' },
  legalLink: { color: colors.link, fontWeight: '700' },
});
