import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

export default function FestivalsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Festivals' }} />
      <Stack.Screen name="suggest" options={{ title: 'Suggest a festival' }} />
    </Stack>
  );
}
