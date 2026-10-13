import { colors, textStyles } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

/**
 * Privacy Policy and Terms of Use (generated from docs/legal/*.md by docs/legal/generate.mjs).
 * Reachable without a session so the agreement checkbox on sign-up can link to them. The back button
 * uses the accessible link colour; pastel `primary` is fill-only and never text (§5.8). The title is the
 * iOS navigation-bar title: `headline` (17, semibold).
 */
export default function LegalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackButtonDisplayMode: 'minimal',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.link,
        headerTitleStyle: {
          color: colors.textPrimary,
          fontSize: textStyles.headline.fontSize,
          fontWeight: textStyles.headline.fontWeight,
        },
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
