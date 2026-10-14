import { getLocalImageCredits, type ImageCredit } from '@festival/data-access';
import { colors, EmptyState, ListRow, ListSection, radii, ScreenHeader, showToast, spacing, textStyles } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { pastelFor } from '@/src/components/palette';
import { RemoteImage, useImageFallback } from '@/src/components/RemoteImage';
import { groupImageCredits, imageCreditSubtitle } from '@/src/hooks/image-credits';
import { queryKeys } from '@/src/hooks/query-keys';
import { useCacheFirstQuery } from '@/src/hooks/use-cache-first-query';
import { goBackOr } from '@/src/providers/launch-route';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';

const THUMB_SIZE = 44;

function openSourcePage(url: string): void {
  Linking.openURL(url).catch(() => showToast("Couldn't open the photo's source page.", 'error'));
}

/** The credited photo itself (from the disk cache when offline); the subject's pastel when it cannot load. */
function CreditThumbnail({ credit }: { credit: ImageCredit }) {
  const { showImage, onError } = useImageFallback(credit.image_url);
  return (
    <View style={[styles.thumb, { backgroundColor: pastelFor(credit.subject_id) }]}>
      {showImage ? <RemoteImage uri={credit.image_url} onError={onError} style={styles.thumbImage} /> : null}
    </View>
  );
}

/**
 * Settings → About → Photo credits: every artist and festival photo this device can show, with its
 * attribution. Cache only, so it works offline and lists exactly the photos the app shows here.
 */
export default function PhotoCreditsScreen() {
  const screenTint = useFestivalScreenTint();
  const credits = useCacheFirstQuery({ queryKey: queryKeys.imageCredits(), readLocal: getLocalImageCredits });
  const groups = React.useMemo(() => groupImageCredits(credits.data ?? []), [credits.data]);

  return (
    <ScrollView style={[styles.screen, { backgroundColor: screenTint }]} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title="Photo credits"
        subtitle="About"
        onBack={() => goBackOr('/settings')}
        backIcon={<Ionicons name="chevron-back" size={22} color={colors.textPrimary} />}
      />

      <Text style={styles.intro}>
        Festie shows artist and festival photos only when they're licensed for it, and credits the people who took them.
      </Text>

      {credits.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.textSecondary} accessibilityLabel="Loading photo credits" />
        </View>
      ) : groups.length === 0 ? (
        <EmptyState title="No photos yet" description="Festie shows licensed photos only, with credit." />
      ) : (
        groups.map((group) => (
          <ListSection key={group.key} title={group.title}>
            {group.rows.map((credit) => {
              const sourceUrl = credit.image_source_url;
              return (
                <ListRow
                  key={`${credit.subject_type}:${credit.subject_id}`}
                  leading={<CreditThumbnail credit={credit} />}
                  title={credit.name}
                  subtitle={imageCreditSubtitle(credit)}
                  onPress={sourceUrl ? () => openSourcePage(sourceUrl) : undefined}
                  accessibilityHint={sourceUrl ? "Opens the photo's source page in a browser" : undefined}
                />
              );
            })}
          </ListSection>
        ))
      )}

      {groups.length > 0 ? <Text style={styles.footer}>Tap a credit to open the page the photo came from.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxxl + spacing.xl },
  intro: { ...textStyles.subheadline, color: colors.textSecondary },
  loading: { alignItems: 'center', paddingVertical: spacing.xxl },
  thumb: { borderRadius: radii.sm, height: THUMB_SIZE, overflow: 'hidden', width: THUMB_SIZE },
  thumbImage: { borderRadius: radii.sm, height: THUMB_SIZE, width: THUMB_SIZE },
  footer: { ...textStyles.caption1, color: colors.textSecondary, textAlign: 'center' },
});
