import { toUserMessage } from '@festival/data-access';
import { colors, continuous, EmptyState, radii, SecondaryButton, spacing, textStyles } from '@festival/ui';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { isOfflineError } from '@/src/hooks/errors';

/** Card-styled loading state for data screens. */
export function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.textPrimary} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

/** Error with a retry action; offline errors get offline copy. */
export function ErrorState({
  error,
  title,
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  const offline = isOfflineError(error);
  return (
    <EmptyState
      title={title ?? (offline ? "You're offline" : "Couldn't load this")}
      description={toUserMessage(error)}
      action={onRetry ? <SecondaryButton label="Try again" onPress={onRetry} /> : undefined}
    />
  );
}

/**
 * One-line note under a list that is showing cached data after a failed background refresh.
 * Renders nothing without an error.
 */
export function StaleDataNote({ error }: { error: unknown }) {
  if (!error) {
    return null;
  }
  const text = isOfflineError(error)
    ? 'Offline — showing what was saved on this device.'
    : `Couldn't refresh — showing saved data. ${toUserMessage(error)}`;
  return (
    <Text style={styles.note} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xxl,
  },
  muted: { ...textStyles.subheadline, color: colors.textSecondary, textAlign: 'center' },
  note: { ...textStyles.footnote, color: colors.textSecondary, paddingHorizontal: spacing.sm, textAlign: 'center' },
});

/** Shown on festival-scoped tabs before any festival is chosen. */
export function NoFestivalState({ onPick }: { onPick: () => void }) {
  return (
    <EmptyState
      title="Pick a festival"
      description="Choose a festival on the Fests tab to see its lineup, your schedule and the map."
      action={<SecondaryButton label="Browse festivals" onPress={onPick} />}
    />
  );
}

/**
 * State for a festival whose bundle isn't on this device yet: downloading, offline, failed, or no
 * longer published. Returns `null` when the bundle is available.
 */
export function FestivalBundleState({
  hasBundle,
  isLoading,
  isRefreshing,
  hasRefreshed,
  refreshError,
  isOffline,
  onRetry,
}: {
  hasBundle: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  hasRefreshed: boolean;
  refreshError: unknown;
  isOffline: boolean;
  onRetry: () => void;
}) {
  if (hasBundle) {
    return null;
  }
  if (isLoading || isRefreshing) {
    return <LoadingState label="Downloading the lineup…" />;
  }
  if (isOffline) {
    return (
      <EmptyState
        title="Not downloaded yet"
        description="Connect to the internet once to download this festival. After that it works without signal."
      />
    );
  }
  if (refreshError) {
    return <ErrorState error={refreshError} onRetry={onRetry} />;
  }
  if (hasRefreshed) {
    return (
      <EmptyState
        title="Festival unavailable"
        description="This festival is no longer listed. Pick another one on the Fests tab."
      />
    );
  }
  return <LoadingState label="Downloading the lineup…" />;
}
