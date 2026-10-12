import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

import { useFestivalScreenTint } from '@/src/providers/screen-tint';

/**
 * Deep links (`festivalapp://group/join?code=…`) open `join` directly; `initialRouteName` puts the
 * crew list underneath so Back lands somewhere sensible.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function GroupLayout() {
  // Every Crews screen sits on the active festival's wash, like the tab roots; screens leave their
  // container background transparent so this one setting paints them all.
  const screenBg = useFestivalScreenTint();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: screenBg },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: screenBg },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Your Crews' }} />
      <Stack.Screen name="create" options={{ title: 'Create Crew' }} />
      <Stack.Screen name="join" options={{ title: 'Join Crew' }} />
      <Stack.Screen name="[groupId]/index" options={{ title: 'Crew' }} />
      <Stack.Screen name="[groupId]/schedule" options={{ title: 'Crew Schedule' }} />
      <Stack.Screen name="[groupId]/meetup/create" options={{ title: 'Create Meetup' }} />
    </Stack>
  );
}
