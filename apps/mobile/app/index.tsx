/**
 * Launch router (§5.1). Decides from the stored session, the cached profile and the terms agreement
 * alone — no network — except for a signed-in user whose profile is not cached yet, who needs one
 * `getMyProfile()` call. That case never falls back to the sign-in screen when offline: it shows a retry
 * screen instead and retries by itself when the connection comes back. Right after a sign-in it first
 * waits for the local owner check (a different account's cache is wiped before anything can show it).
 */
import { toUserMessage } from '@festival/data-access';
import { isOnline } from '@festival/sync-engine';
import { colors, PrimaryButton, radii, spacing, TextLink } from '@festival/ui';
import NetInfo from '@react-native-community/netinfo';
import { Redirect, type Href } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/src/components/BrandMark';
import { LaunchOfflineError, resolveLaunchRoute, resolveLaunchRouteOffline } from '@/src/providers/launch-route';
import { performSignOut, signOutErrorMessage } from '@/src/providers/session-actions';

type LaunchState =
  | { kind: 'resolving' }
  | { kind: 'route'; href: Href }
  | { kind: 'retry'; offline: boolean; message: string };

export default function IndexScreen() {
  const [state, setState] = React.useState<LaunchState>(() => {
    const href = resolveLaunchRouteOffline();
    return href ? { kind: 'route', href } : { kind: 'resolving' };
  });
  const [signingOut, setSigningOut] = React.useState(false);
  const attempt = React.useRef(0);

  const resolve = React.useCallback(() => {
    const current = ++attempt.current;
    setState({ kind: 'resolving' });
    resolveLaunchRoute({ attemptWhenOffline: current > 1 })
      .then((href) => {
        if (current === attempt.current) setState({ kind: 'route', href });
      })
      .catch((error: unknown) => {
        if (current !== attempt.current) return;
        const offline = error instanceof LaunchOfflineError || !isOnline();
        setState({ kind: 'retry', offline, message: offline ? '' : toUserMessage(error) });
      });
  }, []);

  // Network lookup, only when the offline decision was not enough.
  const needsLookup = state.kind === 'resolving' && attempt.current === 0;
  React.useEffect(() => {
    if (needsLookup) resolve();
  }, [needsLookup, resolve]);

  // Offline: retry by itself when the connection comes back (on the offline → online transition only,
  // so a server error is never retried in a loop).
  const waitingForNetwork = state.kind === 'retry' && state.offline;
  React.useEffect(() => {
    if (!waitingForNetwork) return undefined;
    let wasConnected: boolean | null = null;
    return NetInfo.addEventListener((net) => {
      const connected = net.isConnected === true && net.isInternetReachable !== false;
      if (wasConnected === false && connected) resolve();
      wasConnected = connected;
    });
  }, [waitingForNetwork, resolve]);

  const handleUseAnotherAccount = React.useCallback(() => {
    setSigningOut(true);
    performSignOut('sign_out').catch((error: unknown) => {
      setSigningOut(false);
      setState({ kind: 'retry', offline: false, message: signOutErrorMessage(error) });
    });
  }, []);

  if (state.kind === 'route') {
    return <Redirect href={state.href} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconBox} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <BrandMark />
      </View>

      {state.kind === 'resolving' ? (
        <View style={styles.loading} accessible accessibilityLabel="Loading Festie" accessibilityRole="progressbar">
          <ActivityIndicator size="large" color={colors.textPrimary} />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {state.offline ? "You're offline" : "Couldn't finish signing in"}
          </Text>
          <Text style={styles.body}>
            {state.offline
              ? 'Festie needs a connection once to load your profile. After that, your schedule and crews work without signal.'
              : state.message}
          </Text>
          {state.offline ? (
            <Text style={styles.hint}>We&apos;ll try again automatically when you&apos;re back online.</Text>
          ) : null}
          <PrimaryButton label="Try again" onPress={resolve} disabled={signingOut} />
          <View style={styles.linkRow}>
            <TextLink
              align="center"
              label={signingOut ? 'Signing out…' : 'Use a different email'}
              onPress={signingOut ? () => undefined : handleUseAnotherAccount}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.xl,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  iconBox: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#FFB3D9',
    borderRadius: radii.xxl,
    height: 80,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    width: 80,
    elevation: 4,
  },
  loading: { alignItems: 'center', minHeight: 44 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderCard,
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: 'Georgia',
    fontSize: 26,
    fontStyle: 'italic',
    fontWeight: '700',
    textAlign: 'center',
  },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  linkRow: { alignItems: 'center' },
});
