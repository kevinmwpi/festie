import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  reportContent,
  toUserMessage,
  type ReportReason,
  type ReportTargetType,
} from '@festival/data-access';
import {
  colors,
  continuous,
  FieldInput,
  FieldLabel,
  InlineMessage,
  layout,
  PrimaryButton,
  radii,
  showToast,
  spacing,
  tabularNums,
  textStyles,
} from '@festival/ui';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from './BottomSheet';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  sexual: 'Sexual content',
  violence: 'Violence or threats',
  impersonation: 'Impersonation',
  other: 'Something else',
};

export const REPORT_THANKS = "Thanks — we'll review this within 24 hours.";

export interface ReportTarget {
  type: ReportTargetType;
  /** For `photo`, the meetup id. */
  id: string;
  /** What is being reported, for the sheet title ("Report Alex", "Report this photo"). */
  label: string;
}

/**
 * Report flow (§5.4): reason picker + optional details → `reportContent` → thank-you toast. Reporting
 * the same thing twice is fine (the server returns the existing report).
 */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [details, setDetails] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (target) {
      setReason(null);
      setDetails('');
      setError(null);
      setSubmitting(false);
    }
  }, [target]);

  const submit = React.useCallback(async () => {
    if (!target || !reason) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reportContent(target.type, target.id, reason, details.trim() || null);
      onClose();
      showToast(REPORT_THANKS, 'success');
    } catch (reportError) {
      setError(toUserMessage(reportError));
    } finally {
      setSubmitting(false);
    }
  }, [details, onClose, reason, target]);

  return (
    <BottomSheet
      visible={target !== null}
      onClose={onClose}
      title={target?.label ?? 'Report'}
      subtitle="Reports are anonymous to the person you report. Our team reviews every report."
    >
      <FieldLabel>Reason</FieldLabel>
      <View style={styles.reasons} accessibilityRole="radiogroup" accessibilityLabel="Reason">
        {REPORT_REASONS.map((value) => {
          const selected = reason === value;
          return (
            <Pressable
              key={value}
              onPress={() => setReason(value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={REPORT_REASON_LABELS[value]}
              style={({ pressed }) => [styles.reason, selected && styles.reasonSelected, pressed && styles.reasonPressed]}
            >
              <View style={[styles.radio, selected && styles.radioSelected]} />
              <Text style={styles.reasonLabel}>{REPORT_REASON_LABELS[value]}</Text>
            </Pressable>
          );
        })}
      </View>

      <FieldLabel>Details (optional)</FieldLabel>
      <View style={styles.detailsGroup}>
        <FieldInput
          value={details}
          onChangeText={setDetails}
          placeholder="Anything that helps us understand"
          multiline
          maxLength={REPORT_DETAILS_MAX_LENGTH}
          style={styles.details}
          accessibilityLabel="Details, optional"
        />
        <Text style={styles.counter} accessibilityLabel={`${details.length} of ${REPORT_DETAILS_MAX_LENGTH} characters`}>
          {details.length}/{REPORT_DETAILS_MAX_LENGTH}
        </Text>
      </View>

      <InlineMessage message={error} />
      <PrimaryButton label="Send report" onPress={() => void submit()} disabled={!reason} loading={submitting} />
    </BottomSheet>
  );
}

/** Diameter of the radio ring. */
const RADIO_SIZE = 20;

const styles = StyleSheet.create({
  reasons: { gap: spacing.xs },
  reason: {
    ...continuous,
    alignItems: 'center',
    borderColor: colors.borderCard,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.ms,
    minHeight: layout.minTouchTarget + spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reasonSelected: { backgroundColor: colors.inputBg, borderColor: colors.primary },
  reasonPressed: { backgroundColor: colors.fill },
  // The ring is the control's outline: `inputBorder` keeps it at 3:1 or more (WCAG 1.4.11).
  radio: { borderColor: colors.inputBorder, borderRadius: radii.pill, borderWidth: 2, height: RADIO_SIZE, width: RADIO_SIZE },
  radioSelected: { backgroundColor: colors.link, borderColor: colors.link },
  reasonLabel: { ...textStyles.body, color: colors.textPrimary, flexShrink: 1 },
  detailsGroup: { gap: spacing.xs },
  details: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  counter: { ...textStyles.caption1, ...tabularNums, alignSelf: 'flex-end', color: colors.textSecondary },
});
