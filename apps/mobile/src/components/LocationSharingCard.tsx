import {
  colors,
  continuous,
  elevation,
  layout,
  radii,
  SecondaryButton,
  showToast,
  spacing,
  tabularNums,
  textStyles,
} from '@festival/ui';
import React from 'react';
import { AccessibilityInfo, Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { formatAgo, useNow } from '@/src/hooks/use-now';
import { STOP_NOT_CONFIRMED_MESSAGE, useLocationSharing } from '@/src/location/LocationSharingProvider';

import { LocationSharingSheet } from './LocationSharingSheet';

const ACCESS_OFF_TITLE = 'Location access is off';

function formatRemaining(expiresAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((expiresAt - now) / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Truthful sharing status for one crew with Start/Stop. `otherGroupName` resolves the crew currently
 * shared with when it is a different one.
 */
export function LocationSharingCard({
  groupId,
  groupName,
  resolveGroupName,
}: {
  groupId: string;
  groupName: string;
  resolveGroupName: (groupId: string) => string | null;
}) {
  const sharing = useLocationSharing();
  const now = useNow(30_000);
  const [sheetVisible, setSheetVisible] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);

  const isThisGroup = sharing.groupId === groupId && sharing.status !== 'off';
  const otherGroupName = sharing.groupId && sharing.groupId !== groupId ? (resolveGroupName(sharing.groupId) ?? 'another crew') : null;

  let title = 'Location sharing is off';
  let detail = 'Let this crew see where you are on the map while Festie is open.';
  if (isThisGroup) {
    if (sharing.status === 'permission_denied') {
      title = ACCESS_OFF_TITLE;
      detail = sharing.canAskAgain
        ? "Festie can't read your location, so your crew can't see you. To keep sharing, turn location back on — iOS will ask you next."
        : "Festie can't read your location, so your crew can't see you. Turn on location access in Settings.";
    } else {
      title = sharing.status === 'paused' ? 'Sharing paused' : 'Sharing your location';
      const ends = sharing.expiresAt ? `Ends in ${formatRemaining(sharing.expiresAt, now)}` : '';
      const sent = sharing.lastSentAt
        ? `last update ${formatAgo(sharing.lastSentAt, now)}`
        : sharing.lastErrorAt
          ? 'waiting for signal'
          : 'getting your position';
      detail = `${ends}${ends ? ' · ' : ''}${sent}.`;
    }
  } else if (otherGroupName) {
    detail = `You're sharing with ${otherGroupName}. Starting here stops that.`;
  }

  // iOS has no live regions (Android's is on the title below), so VoiceOver hears status changes here.
  // Starting and expiry already speak through toasts (the sheet's and the provider's; a second announcement
  // would cut them off), stopping is the user's own Stop tap, and `paused` only happens in the background,
  // so this covers losing location access and getting it back. The first render stays quiet.
  const previousTitle = React.useRef(title);
  React.useEffect(() => {
    const previous = previousTitle.current;
    previousTitle.current = title;
    if (Platform.OS === 'ios' && previous !== title && (title === ACCESS_OFF_TITLE || previous === ACCESS_OFF_TITLE)) {
      AccessibilityInfo.announceForAccessibility(title);
    }
  }, [title]);

  const stop = React.useCallback(async () => {
    setStopping(true);
    try {
      if (!(await sharing.stop())) {
        showToast(STOP_NOT_CONFIRMED_MESSAGE, 'error');
      }
    } finally {
      setStopping(false);
    }
  }, [sharing]);

  const [requesting, setRequesting] = React.useState(false);
  const resumeLocation = React.useCallback(async () => {
    setRequesting(true);
    try {
      await sharing.requestAccess();
    } finally {
      setRequesting(false);
    }
  }, [sharing]);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {/* Decorative: the title says the same. The slot is one title line tall, so the dot centres on it. */}
        <View style={styles.dotSlot}>
          <View style={[styles.dot, isThisGroup && sharing.status === 'sharing' ? styles.dotOn : isThisGroup ? styles.dotWarn : null]} />
        </View>
        <View style={styles.text}>
          {/* The title changes only with the sharing state, so TalkBack announces real changes (VoiceOver is
              handled above); the detail line ticks every 30 seconds and is not a live region. */}
          <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
            {title}
          </Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      </View>
      {isThisGroup ? (
        <View style={styles.actions}>
          {sharing.status === 'permission_denied' ? (
            sharing.canAskAgain ? (
              // Neutral label (App Review 5.1.1): the iOS permission prompt follows this tap.
              <SecondaryButton label="Turn location back on" onPress={() => void resumeLocation()} loading={requesting} />
            ) : (
              <SecondaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
            )
          ) : null}
          <SecondaryButton label="Stop sharing" onPress={() => void stop()} loading={stopping} />
        </View>
      ) : (
        <SecondaryButton label="Share my location" onPress={() => setSheetVisible(true)} />
      )}
      <LocationSharingSheet
        visible={sheetVisible}
        groupId={groupId}
        groupName={groupName}
        otherGroupName={otherGroupName}
        onClose={() => setSheetVisible(false)}
      />
    </View>
  );
}

/** Diameter of the status dot. */
const DOT_SIZE = spacing.ms;

const styles = StyleSheet.create({
  card: {
    ...continuous,
    ...elevation.card,
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: layout.cardPadding,
  },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  dotSlot: { height: textStyles.headline.lineHeight, justifyContent: 'center' },
  dot: { backgroundColor: colors.textTertiary, borderRadius: radii.pill, height: DOT_SIZE, width: DOT_SIZE },
  dotOn: { backgroundColor: colors.successText },
  dotWarn: { backgroundColor: colors.warningText },
  text: { flex: 1, gap: spacing.xs },
  title: { ...textStyles.headline, color: colors.textPrimary },
  detail: { ...textStyles.footnote, ...tabularNums, color: colors.textSecondary },
  actions: { gap: spacing.sm },
});
