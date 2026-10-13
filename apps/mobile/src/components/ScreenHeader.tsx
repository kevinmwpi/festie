import { BackChevron, colors, IconButton, layout, spacing, textStyles } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WORDMARK_FONT } from '@/src/config/fonts';

/**
 * Tab-root header: the "Festie" wordmark (`WORDMARK_FONT`) over a sentence-case breadcrumb, with an
 * optional trailing control (e.g. the settings avatar). Breadcrumbs use `textPrimary` (§5.8 — accents are
 * fill-only).
 */
export function ScreenHeader({ crumbs, right }: { crumbs: Array<string | null | undefined>; right?: React.ReactNode }) {
  const parts = crumbs.filter((crumb): crumb is string => Boolean(crumb));
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        {/* Brand only: the breadcrumb below is the screen's heading. Its growth is capped so the wordmark
            never pushes the trailing control off the row. */}
        <Text style={styles.wordmark} maxFontSizeMultiplier={1.3}>
          Festie
        </Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      <View style={styles.breadcrumb} accessible accessibilityRole="header" accessibilityLabel={parts.join(', ')}>
        {parts.map((crumb, index) => (
          <React.Fragment key={`${crumb}-${index}`}>
            {index > 0 ? <Text style={styles.separator}>›</Text> : null}
            <Text
              style={[styles.crumb, index === 0 ? styles.crumbActive : styles.crumbTrail]}
              // The heading crumb wraps at very large text sizes instead of truncating; the trail gives way.
              numberOfLines={index === 0 ? undefined : 1}
            >
              {crumb}
            </Text>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * Header for screens pushed inside a tab stack: a 44pt back button, a `title1` title and an optional
 * `subheadline` line.
 */
export function SubScreenHeader({
  title,
  label,
  onBack,
  right,
}: {
  title: string;
  label?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const goBack = React.useCallback(() => {
    if (onBack) {
      onBack();
    } else if (router.canGoBack()) {
      router.back();
    }
  }, [onBack]);

  return (
    <View style={styles.subHeader}>
      <View style={styles.subRow}>
        <IconButton icon={<BackChevron />} accessibilityLabel="Back" onPress={goBack} />
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      <Text style={styles.subTitle} accessibilityRole="header">
        {title}
      </Text>
      {label ? <Text style={styles.subLabel}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xxs,
    paddingBottom: spacing.xs,
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing.xl + spacing.xs,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  // The Fredoka logotype is the one custom face; its two sizes (40 here, 52 on sign-in) are the only sizes outside
  // `textStyles`. Single weight, so no fontWeight; no tracking.
  wordmark: {
    color: colors.textPrimary,
    fontFamily: WORDMARK_FONT,
    fontSize: 40,
  },
  right: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  breadcrumb: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs + spacing.xxs },
  separator: { ...textStyles.subheadline, color: colors.textTertiary },
  crumb: { ...textStyles.subheadline },
  crumbActive: { color: colors.textPrimary, flexShrink: 1, fontWeight: '600' },
  // When the row is too narrow the festival name gives way first; the heading only wraps at extreme sizes.
  crumbTrail: { color: colors.textSecondary, flexShrink: 3 },

  subHeader: { gap: spacing.xs, paddingBottom: spacing.sm, paddingHorizontal: layout.screenGutter, paddingTop: spacing.md },
  subRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs, marginLeft: -spacing.xs },
  subTitle: { ...textStyles.title1, color: colors.textPrimary },
  subLabel: { ...textStyles.subheadline, color: colors.textSecondary },
});
