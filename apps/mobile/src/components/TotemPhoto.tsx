import { getTotemSignedUrl } from '@festival/data-access';
import { Ionicons } from '@expo/vector-icons';
import { colors, continuous, IconButton, layout, radii, spacing, textStyles } from '@festival/ui';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { queryKeys } from '@/src/hooks/query-keys';
import { useUserKey } from '@/src/hooks/use-session';

/**
 * A meetup's totem photo from the private bucket via a short-lived signed URL (cached ~45 min), with
 * a Report control on the photo for anyone but its owner.
 */
export function TotemPhoto({
  path,
  meetupTitle,
  onReport,
}: {
  path: string;
  meetupTitle: string;
  /** Omit for the photo's owner. */
  onReport?: () => void;
}) {
  const userKey = useUserKey();
  const urlQuery = useQuery({
    queryKey: queryKeys.totemUrl(userKey, path),
    queryFn: () => getTotemSignedUrl(path),
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
    retry: 1,
  });
  const [failed, setFailed] = React.useState(false);

  return (
    // The report button sits outside the clipped frame so its shadow is not cut off by the rounded corners.
    <View style={styles.container}>
      <View style={styles.frame}>
        {urlQuery.data && !failed ? (
          <Image
            source={{ uri: urlQuery.data }}
            style={styles.image}
            resizeMode="cover"
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Totem photo for ${meetupTitle}`}
            onError={() => setFailed(true)}
          />
        ) : (
          <View style={[styles.placeholder, onReport ? styles.placeholderBesideReport : null]}>
            {urlQuery.isPending && !failed ? (
              <ActivityIndicator color={colors.textPrimary} accessibilityLabel="Loading photo" />
            ) : (
              <Text style={styles.placeholderText}>Photo unavailable right now — check your connection.</Text>
            )}
          </View>
        )}
      </View>
      {onReport ? (
        <View style={styles.reportButton}>
          <IconButton
            icon={<Ionicons name="flag-outline" size={20} color={colors.textPrimary} />}
            accessibilityLabel={`Report the photo for ${meetupTitle}`}
            onPress={onReport}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Room the placeholder text leaves on each side for the 44pt report button in the corner. */
const REPORT_CLEARANCE = layout.minTouchTarget + spacing.md;

const styles = StyleSheet.create({
  container: { position: 'relative' },
  frame: { ...continuous, borderRadius: radii.lg, overflow: 'hidden' },
  image: { height: 200, width: '100%' },
  placeholder: {
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    justifyContent: 'center',
    minHeight: 120,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  placeholderBesideReport: { paddingHorizontal: REPORT_CLEARANCE },
  placeholderText: { ...textStyles.footnote, color: colors.textSecondary, textAlign: 'center' },
  reportButton: { position: 'absolute', right: spacing.sm, top: spacing.sm },
});
