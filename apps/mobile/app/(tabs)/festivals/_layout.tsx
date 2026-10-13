import { colors } from '@festival/ui';
import { Stack } from 'expo-router';
import React from 'react';

export default function FestivalsLayout() {
  return (
    <Stack
      screenOptions={{
        // The screen draws its own header. Its festival wash is translucent and composites over this
        // background, so changing it changes the colour of every festival wash.
        contentStyle: { backgroundColor: colors.background },
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Festivals' }} />
    </Stack>
  );
}
