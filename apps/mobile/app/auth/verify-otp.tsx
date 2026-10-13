import { requestEmailCode, toUserMessage, verifyEmailCode } from '@festival/data-access';
import {
  colors,
  continuous,
  InlineMessage,
  layout,
  PrimaryButton,
  radii,
  showToast,
  spacing,
  tabularNums,
  TextLink,
  textStyles,
  upright,
} from '@festival/ui';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyboardAvoidingScreen } from '@/src/components/KeyboardAvoidingScreen';
import { OTP_LENGTH } from '@/src/config/app-info';
import { resetTo } from '@/src/providers/launch-route';
import { trackSignIn } from '@/src/providers/owner-check';
import { notifySessionChanged } from '@/src/providers/session-state';

/** Pasted codes of this length are accepted with the Verify button (sign-in codes and review codes). */
const MIN_CODE_LENGTH = 6;
const MAX_CODE_LENGTH = 10;
const RESEND_COOLDOWN_S = 60;

/**
 * Code cells share the row (`flex: 1`), capped for wide screens. On a 375pt phone (335pt row) the 8 cells
 * are about 35pt wide with an 8pt gap; a pasted 10-digit code switches to the dense row (4pt gap, tighter
 * corners), about 30pt per cell.
 */
const OTP_CELL_MAX_WIDTH = 48;
const OTP_CELL_MIN_HEIGHT = 56;
/**
 * The digits follow Dynamic Type up to 1.4×: a `title2` digit then draws at about 31pt, roughly 19pt wide
 * and 39pt tall, which still fits the ~26pt inner width of a dense 10-digit cell and the 56pt cell height.
 * Past that the digits would overflow the cells. VoiceOver reads the code from the input, not the cells.
 */
const OTP_DIGIT_MAX_SCALE = 1.4;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** "an 8-digit code", "a 6-digit code": the article follows the spoken number (eight, eleven, eighteen). */
function digitCountArticle(count: number): 'a' | 'an' {
  return /^8|^1[18]$/.test(String(count)) ? 'an' : 'a';
}

export default function VerifyOtpScreen() {
  const params = useLocalSearchParams<{ email?: string; sent?: string }>();
  const email = firstParam(params.email).trim();
  // Arriving via "I already have a code" (`sent=0`): no code was just sent, so resending is allowed now.
  const justSent = firstParam(params.sent) !== '0';

  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [cooldownEndsAt, setCooldownEndsAt] = React.useState<number>(() => (justSent ? Date.now() + RESEND_COOLDOWN_S * 1000 : 0));
  const [now, setNow] = React.useState(() => Date.now());
  const inputRef = React.useRef<TextInput>(null);
  const verifyingRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // After a rejected code, bring the keyboard back for the retry. This runs once the input is editable
  // again: focusing from the submit handler happens while it is still disabled and is ignored.
  React.useEffect(() => {
    if (!verifying && error) inputRef.current?.focus();
  }, [verifying, error]);

  const secondsLeft = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000));

  React.useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  // The countdown text ticks every second, so it is not a live region. Screen readers hear one
  // announcement when the cooldown ends instead (not on arrival, when resending is already allowed).
  const canResend = secondsLeft <= 0;
  const couldResendRef = React.useRef(canResend);
  React.useEffect(() => {
    if (canResend && !couldResendRef.current) {
      AccessibilityInfo.announceForAccessibility('You can resend the code now');
    }
    couldResendRef.current = canResend;
  }, [canResend]);

  const submit = React.useCallback(
    async (candidate: string) => {
      if (verifyingRef.current || candidate.length < MIN_CODE_LENGTH || candidate.length > MAX_CODE_LENGTH) return;
      verifyingRef.current = true;
      setVerifying(true);
      setError(null);
      try {
        // Tracked so the launch route waits for the local owner check inside it: the session guard
        // lands on `index` at `SIGNED_IN`, before this call has finished claiming the local cache.
        await trackSignIn(verifyEmailCode(email, candidate));
        notifySessionChanged();
        // The session guard in the root layout normally removes this screen and lands on the launch
        // route already (profile setup, the join screen for a remembered invite, or the app); this only
        // covers the screen still being shown.
        if (mountedRef.current) resetTo('/');
      } catch (verifyError) {
        setError(toUserMessage(verifyError));
        setCode('');
      } finally {
        verifyingRef.current = false;
        setVerifying(false);
      }
    },
    [email],
  );

  const handleChange = React.useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, '').slice(0, MAX_CODE_LENGTH);
      setCode(digits);
      if (error) setError(null);
      // Auto-submit only for a complete sign-in code; longer pasted codes use the Verify button.
      if (digits.length === OTP_LENGTH) {
        void submit(digits);
      }
    },
    [error, submit],
  );

  const handleResend = React.useCallback(async () => {
    if (resending || secondsLeft > 0) return;
    setResending(true);
    setError(null);
    try {
      await requestEmailCode(email);
      setCooldownEndsAt(Date.now() + RESEND_COOLDOWN_S * 1000);
      setNow(Date.now());
      setCode('');
      showToast(`New code sent to ${email}`, 'success');
    } catch (resendError) {
      setError(toUserMessage(resendError));
    } finally {
      setResending(false);
    }
  }, [email, resending, secondsLeft]);

  const handleChangeEmail = React.useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/auth/enter-email');
    }
  }, []);

  if (!email) {
    return (
      // Scrolls instead of clipping at large text sizes.
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.centered}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title} accessibilityRole="header">Verify code</Text>
        <Text style={styles.subtitle}>Enter your email first so we know where to send the code.</Text>
        <PrimaryButton label="Enter email" onPress={() => router.replace('/auth/enter-email')} />
      </ScrollView>
    );
  }

  const boxCount = Math.max(OTP_LENGTH, code.length);
  const dense = boxCount > OTP_LENGTH;
  const canVerify = code.length >= MIN_CODE_LENGTH && code.length <= MAX_CODE_LENGTH;

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Verify code</Text>
            <Text style={styles.subtitle}>
              {justSent
                ? `We sent ${digitCountArticle(OTP_LENGTH)} ${OTP_LENGTH}-digit code to ${email}`
                : `Enter the ${OTP_LENGTH}-digit code we emailed to ${email}`}
            </Text>
          </View>

          {/* Code boxes over one transparent input: taps focus it, and it receives typing, paste and
              the keyboard's one-time-code autofill. */}
          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={[styles.otpRow, dense && styles.otpRowDense]}
            accessible={false}
            importantForAccessibility="no"
          >
            {Array.from({ length: boxCount }).map((_, index) => {
              const active = index === code.length && !verifying;
              return (
                <View
                  key={index}
                  style={[styles.otpCell, dense && styles.otpCellDense, active && styles.otpCellActive, error ? styles.otpCellError : null]}
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  <Text style={styles.otpText} maxFontSizeMultiplier={OTP_DIGIT_MAX_SCALE}>
                    {code[index] ?? ''}
                  </Text>
                </View>
              );
            })}
            {/* The number pad has no return key on iOS, so `onSubmitEditing` only fires on Android; codes
                that do not auto-submit use the Verify button, which stays above the keyboard. */}
            <TextInput
              ref={inputRef}
              accessibilityLabel={`Sign-in code, ${OTP_LENGTH} digits`}
              accessibilityHint="The code is checked automatically when complete"
              autoComplete="one-time-code"
              autoFocus
              caretHidden
              contextMenuHidden={false}
              editable={!verifying}
              keyboardType="number-pad"
              maxLength={MAX_CODE_LENGTH}
              onChangeText={handleChange}
              onSubmitEditing={() => void submit(code)}
              selectionColor="transparent"
              style={styles.hiddenInput}
              textContentType="oneTimeCode"
              value={code}
            />
          </Pressable>

          <InlineMessage message={error} />

          <PrimaryButton
            label={verifying ? 'Checking code…' : 'Verify'}
            loading={verifying}
            disabled={!canVerify}
            onPress={() => void submit(code)}
          />

          <View style={styles.links}>
            {secondsLeft > 0 ? (
              <Text style={styles.helper}>
                Didn&apos;t get it? Check spam, or resend in {secondsLeft}s
              </Text>
            ) : (
              <TextLink
                align="center"
                role="button"
                label={resending ? 'Sending…' : 'Resend code'}
                busy={resending}
                accessibilityLabel={`Resend code to ${email}`}
                onPress={() => void handleResend()}
              />
            )}
            <TextLink align="center" label="Use a different email" onPress={handleChangeEmail} />
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
  centered: {
    flexGrow: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.xxxl,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.xxxl,
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
  otpRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  otpRowDense: { gap: spacing.xs },
  // Nearly transparent rather than 0-sized/opacity 0, which some platforms treat as not focusable.
  hiddenInput: {
    ...StyleSheet.absoluteFillObject,
    color: 'transparent',
    fontSize: 1,
    opacity: 0.02,
  },
  // Flat like every text field; the outline (3.90:1 on white) shows where each empty cell is.
  otpCell: {
    ...continuous,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    maxWidth: OTP_CELL_MAX_WIDTH,
    minHeight: OTP_CELL_MIN_HEIGHT,
  },
  // ~30pt-wide cells: a tighter radius so the corners do not clamp into pill ends.
  otpCellDense: { borderRadius: radii.sm },
  otpCellActive: {
    borderColor: colors.link,
    borderWidth: 2,
  },
  otpCellError: {
    borderColor: colors.destructive,
  },
  otpText: { ...textStyles.title2, ...upright, ...tabularNums, color: colors.textPrimary },
  links: {
    alignItems: 'center',
    // TextLink is 20pt tall with 12pt hitSlop above and below: 24pt apart, the touch areas don't overlap.
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  // Same metrics as the TextLink label (`subheadline`) that replaces it, so nothing jumps when the
  // countdown ends; tabular digits keep the line from jittering while it ticks.
  helper: { ...textStyles.subheadline, ...tabularNums, color: colors.textSecondary, textAlign: 'center' },
});
