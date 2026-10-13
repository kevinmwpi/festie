import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

/** The map draws its own overlays, so the stack has no native header. */
export default function MapLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Festival map' }} />
    </Stack>
  );
}
