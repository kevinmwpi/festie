import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

export default function ScheduleLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'My schedule' }} />
      <Stack.Screen name="browse" options={{ title: 'Browse lineup' }} />
    </Stack>
  );
}
