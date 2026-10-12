import { colors, IconButton, spacing } from '@festival/ui';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WORDMARK_FONT } from '@/src/config/fonts';

/**
 * Tab-root header: the "Festie" wordmark (`WORDMARK_FONT`) over an uppercase breadcrumb, with an optional
 * trailing control (e.g. the settings avatar). Breadcrumbs use `textPrimary` (§5.8 — accents are
 * fill-only).
 */
export function ScreenHeader({ crumbs, right }: { crumbs: Array<string | null | undefined>; right?: React.ReactNode }) {
  const parts = crumbs.filter((crumb): crumb is string => Boolean(crumb));
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        {/* Brand only: the breadcrumb below is the screen's heading. */}
        <Text style={styles.wordmark}>Festie</Text>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      <View style={styles.breadcrumb} accessible accessibilityRole="header" accessibilityLabel={parts.join(', ')}>
        {parts.map((crumb, index) => (
          <React.Fragment key={`${crumb}-${index}`}>
            {index > 0 ? <Text style={styles.separator}>›</Text> : null}
            <Text
              style={[styles.crumb, index === 0 ? styles.crumbActive : styles.crumbTrail]}
              numberOfLines={1}
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
 * Header for screens pushed inside a tab stack: a 44pt back button, a Georgia-italic title and an
 * uppercase micro-label.
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
        <IconButton icon="‹" accessibilityLabel="Back" onPress={goBack} />
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
    gap: 4,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 4,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  wordmark: {
    color: colors.textPrimary,
    fontFamily: WORDMARK_FONT,
    fontSize: 40,
    letterSpacing: -0.5,
  },
  right: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  breadcrumb: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  separator: { color: colors.textSecondary, fontSize: 11 },
  crumb: { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  crumbActive: { color: colors.textPrimary, fontWeight: '800' },
  crumbTrail: { color: colors.textSecondary, flexShrink: 1, fontWeight: '600' },

  subHeader: { gap: spacing.xs, paddingBottom: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  subRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  subTitle: { color: colors.textPrimary, fontFamily: 'Georgia', fontSize: 28, fontStyle: 'italic', fontWeight: '700' },
  subLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
});
