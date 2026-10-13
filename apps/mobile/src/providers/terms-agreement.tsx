/**
 * The explicit "I agree to the Terms of Use and Privacy Policy" checkbox (§5.2) with the community
 * rules (App Review guideline 1.2: zero tolerance for objectionable content and abusive users). Shared
 * by profile setup and the one-time agreement screen for existing accounts (`/auth/accept-terms`).
 */
import { Checkbox, checkboxLabelStyle, colors, spacing, textStyles } from '@festival/ui';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { openPrivacyPolicy, openTermsOfUse } from './external-links';

/** Shown when the user tries to continue without ticking the box. */
export const TERMS_REQUIRED_MESSAGE = 'Please agree to the Terms of Use and Privacy Policy to continue.';

/**
 * The note lines up with the checkbox label: `Checkbox` draws a 24pt box with a `spacing.ms` gap before
 * its label (packages/ui/src/identity.tsx). Update this if either changes.
 */
const CHECKBOX_SIZE = 24;
const LABEL_INSET = CHECKBOX_SIZE + spacing.ms;

export function TermsAgreement({ agreed, onChange }: { agreed: boolean; onChange: (agreed: boolean) => void }) {
  return (
    <View style={styles.terms}>
      <Checkbox
        checked={agreed}
        onChange={onChange}
        accessibilityLabel="I agree to the Terms of Use and Privacy Policy"
        accessibilityActions={[
          { name: 'openTerms', label: 'Open Terms of Use' },
          { name: 'openPrivacy', label: 'Open Privacy Policy' },
        ]}
        onAccessibilityAction={(action) => {
          if (action === 'openTerms') openTermsOfUse();
          if (action === 'openPrivacy') openPrivacyPolicy();
        }}
        label={
          <Text style={checkboxLabelStyle}>
            I agree to the{' '}
            <Text style={styles.link} onPress={openTermsOfUse} accessibilityRole="link">
              Terms of Use
            </Text>{' '}
            and{' '}
            <Text style={styles.link} onPress={openPrivacyPolicy} accessibilityRole="link">
              Privacy Policy
            </Text>
          </Text>
        }
      />
      <Text style={styles.note}>
        Festie has zero tolerance for objectionable content or abusive users: no harassment, hate or explicit content.
        You can report or block anyone, and we review reports within 24 hours.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  terms: { gap: spacing.xs },
  // Same inline-link style as the sign-in screen's legal line: `link`, semibold, underlined.
  link: { color: colors.link, fontWeight: '600', textDecorationLine: 'underline' },
  note: { ...textStyles.footnote, color: colors.textSecondary, paddingLeft: LABEL_INSET },
});
