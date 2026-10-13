import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

/**
 * Deep links (`festivalapp://group/join?code=…`) open `join` directly; `initialRouteName` puts the
 * crew list underneath so Back lands somewhere sensible.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function GroupLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Your crews' }} />
      <Stack.Screen name="create" options={{ title: 'Create crew' }} />
      <Stack.Screen name="join" options={{ title: 'Join crew' }} />
      <Stack.Screen name="[groupId]/index" options={{ title: 'Crew' }} />
      <Stack.Screen name="[groupId]/schedule" options={{ title: 'Crew schedule' }} />
      <Stack.Screen name="[groupId]/meetup/create" options={{ title: 'Create meetup' }} />
    </Stack>
  );
}
