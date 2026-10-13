import { toUserMessage } from '@festival/data-access';
import {
  colors,
  continuous,
  FieldLabel,
  InlineMessage,
  layout,
  PrimaryButton,
  radii,
  showToast,
  spacing,
  textStyles,
} from '@festival/ui';
import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DEFAULT_SHARING_DURATION_MS,
  LocationPermissionError,
  SHARING_DURATION_OPTIONS,
  useLocationSharing,
} from '@/src/location/LocationSharingProvider';

import { BottomSheet } from './BottomSheet';

/** Canonical explainer copy (§5.6 / §8 retention wording). */
export function locationSharingExplainer(groupName: string): string {
  return `Only members of ${groupName} can see your location, only while Festie is open, for the time you choose. Your position is visible to your crew for at most 15 minutes after the last update, then deleted.`;
}

/**
 * Shown before every start of location sharing: the explainer, then a duration choice (1 h, 4 h,
 * 8 h default, "Until I stop" — max 24 h). The OS permission prompt only appears after "Start sharing".
 */
export function LocationSharingSheet({
  visible,
  groupId,
  groupName,
  otherGroupName,
  onClose,
}: {
  visible: boolean;
  groupId: string;
  groupName: string;
  /** Name of the crew currently shared with, when starting here replaces it. */
  otherGroupName?: string | null;
  onClose: () => void;
}) {
  const sharing = useLocationSharing();
  const [durationMs, setDurationMs] = React.useState(DEFAULT_SHARING_DURATION_MS);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      setDurationMs(DEFAULT_SHARING_DURATION_MS);
      setError(null);
      setStarting(false);
    }
  }, [visible]);

  const start = React.useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await sharing.start(groupId, durationMs);
      onClose();
      showToast(`Sharing your location with ${groupName}.`, 'success');
    } catch (startError) {
      if (startError instanceof LocationPermissionError) {
        if (!startError.canAskAgain) {
          Alert.alert('Location access is off', startError.message, [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ]);
        } else {
          setError(startError.message);
        }
      } else {
        setError(toUserMessage(startError));
      }
    } finally {
      setStarting(false);
    }
  }, [durationMs, groupId, groupName, onClose, sharing]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Share your location">
      <View style={styles.explainer}>
        <Text style={styles.explainerText}>{locationSharingExplainer(groupName)}</Text>
      </View>

      {otherGroupName ? (
        <Text style={styles.note}>This stops sharing with {otherGroupName}.</Text>
      ) : null}

      <FieldLabel>Share for</FieldLabel>
      <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="Share for">
        {SHARING_DURATION_OPTIONS.map((option) => {
          const selected = option.durationMs === durationMs;
          return (
            <Pressable
              key={option.key}
              onPress={() => setDurationMs(option.durationMs)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.key === 'until_stop' ? 'Until I stop, at most 24 hours' : option.label}
              style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.optionPressed]}
            >
              <View style={[styles.radio, selected && styles.radioSelected]} />
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                {option.key === 'until_stop' ? <Text style={styles.optionSub}>Ends after 24 hours at most</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <InlineMessage message={error} />
      <PrimaryButton label="Start sharing" onPress={() => void start()} loading={starting} />
    </BottomSheet>
  );
}

/** Diameter of the radio ring. */
const RADIO_SIZE = 20;

const styles = StyleSheet.create({
  explainer: { ...continuous, backgroundColor: colors.inputBg, borderRadius: radii.lg, padding: spacing.lg },
  explainerText: { ...textStyles.subheadline, color: colors.textPrimary },
  note: { ...textStyles.footnote, color: colors.textSecondary },
  options: { gap: spacing.xs },
  option: {
    ...continuous,
    alignItems: 'center',
    borderColor: colors.borderCard,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.ms,
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionSelected: { backgroundColor: colors.inputBg, borderColor: colors.primary },
  optionPressed: { backgroundColor: colors.fill },
  // The ring is the control's outline: `inputBorder` keeps it at 3:1 or more (WCAG 1.4.11).
  radio: { borderColor: colors.inputBorder, borderRadius: radii.pill, borderWidth: 2, height: RADIO_SIZE, width: RADIO_SIZE },
  radioSelected: { backgroundColor: colors.link, borderColor: colors.link },
  optionText: { flex: 1, gap: spacing.xxs },
  optionLabel: { ...textStyles.body, color: colors.textPrimary },
  optionSub: { ...textStyles.footnote, color: colors.textSecondary },
});
