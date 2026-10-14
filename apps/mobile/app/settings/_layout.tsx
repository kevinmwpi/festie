import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

/**
 * A screen opened cold from a deep link (`festivalapp://settings/profile`) still gets Settings beneath
 * it, so its back button has somewhere to go.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

/** Settings stack (§5.3), opened from the avatar button in the Fests header. Screens draw their own headers. */
export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="profile" />
      <Stack.Screen name="blocked-users" />
      <Stack.Screen name="credits" />
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}
