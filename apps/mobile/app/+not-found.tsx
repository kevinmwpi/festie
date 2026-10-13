import { colors, EmptyState, layout, PrimaryButton, spacing } from '@festival/ui';
import { router, Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { resetTo } from '@/src/providers/launch-route';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Scrolls instead of clipping at large text sizes. */}
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <EmptyState
          title="Nothing here"
          description="This link doesn't lead anywhere in Festie. It may be out of date."
          action={
            <View style={styles.action}>
              <PrimaryButton label="Go to Festie" onPress={() => (router.canGoBack() ? router.back() : resetTo('/'))} />
            </View>
          }
        />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: layout.screenGutter,
  },
  action: { alignSelf: 'stretch', marginTop: spacing.md },
});
