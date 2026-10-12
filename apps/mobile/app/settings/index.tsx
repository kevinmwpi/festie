import { getLocalGroups } from '@festival/data-access';
import { Avatar, colors, DestructiveButton, ListRow, ListSection, ScreenHeader, showToast, spacing } from '@festival/ui';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import React from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text } from 'react-native';

import { APP_VERSION_LABEL, SUPPORT_EMAIL, SUPPORT_URL } from '@/src/config/app-info';
import { STOP_NOT_CONFIRMED_MESSAGE, useLocationSharing, type LocationSharingStatus } from '@/src/location/LocationSharingProvider';
import {
  openPrivacyPolicy,
  openSupportEmail,
  openSupportUrl,
  openTermsOfUse,
} from '@/src/providers/external-links';
import { goBackOr, HOME_HREF } from '@/src/providers/launch-route';
import { getPendingCount, performSignOut, signOutErrorMessage } from '@/src/providers/session-actions';
import { useCachedProfile } from '@/src/providers/session-state';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';

type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unknown';

function useNotificationPermission(): NotificationPermission {
  const [permission, setPermission] = React.useState<NotificationPermission>('unknown');

  const refresh = React.useCallback(() => {
    Notifications.getPermissionsAsync()
      .then((result) => {
        const provisional = result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
        setPermission(result.granted || provisional ? 'granted' : result.status === 'denied' ? 'denied' : 'undetermined');
      })
      .catch(() => setPermission('unknown'));
  }, []);

  // Re-read on focus and when returning from the system Settings app.
  useFocusEffect(refresh);
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return permission;
}

function formatUntil(expiresAt: number): string {
  const end = new Date(expiresAt);
  const time = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = end.toDateString() === new Date().toDateString();
  return sameDay ? `until ${time}` : `until ${end.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function sharingCopy(
  status: LocationSharingStatus,
  crewName: string | null,
  expiresAt: number | null,
  canAskAgain: boolean,
): { value: string; subtitle: string } {
  const crew = crewName ?? 'your crew';
  switch (status) {
    case 'sharing':
      return { value: 'On', subtitle: `Sharing with ${crew}${expiresAt ? ` ${formatUntil(expiresAt)}` : ''}` };
    case 'paused':
      return { value: 'Paused', subtitle: `Sharing with ${crew} resumes when you open Festie` };
    case 'permission_denied':
      return {
        value: 'No access',
        subtitle: canAskAgain
          ? 'Tap to turn location back on and keep sharing with your crew — iOS will ask you next'
          : 'Turn on location access for Festie in Settings to share with your crew',
      };
    default:
      return { value: 'Off', subtitle: "Turn it on from a crew's map when you want friends to find you" };
  }
}

export default function SettingsScreen() {
  const screenTint = useFestivalScreenTint();
  const profile = useCachedProfile();
  const sharing = useLocationSharing();
  const notifications = useNotificationPermission();
  const [signingOut, setSigningOut] = React.useState(false);
  const [stoppingShare, setStoppingShare] = React.useState(false);

  const sharingGroupId = sharing.status === 'off' ? null : sharing.groupId;
  const crewQuery = useQuery({
    queryKey: ['settings', 'sharing-crew', profile?.auth_user_id ?? null, sharingGroupId],
    queryFn: async () => {
      const groups = await getLocalGroups();
      return groups.find((group) => group.id === sharingGroupId)?.name ?? null;
    },
    enabled: sharingGroupId !== null,
  });
  const sharingText = sharingCopy(sharing.status, crewQuery.data ?? null, sharing.expiresAt, sharing.canAskAgain);

  const confirmStopSharing = React.useCallback(() => {
    Alert.alert('Stop sharing your location?', 'Your crew will no longer see where you are.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop sharing',
        style: 'destructive',
        onPress: () => {
          setStoppingShare(true);
          void sharing
            .stop()
            .then((removed) =>
              removed ? showToast('Location sharing stopped', 'success') : showToast(STOP_NOT_CONFIRMED_MESSAGE, 'error'),
            )
            .finally(() => setStoppingShare(false));
        },
      },
    ]);
  }, [sharing]);

  const runSignOut = React.useCallback(() => {
    setSigningOut(true);
    performSignOut('sign_out').catch((error: unknown) => {
      setSigningOut(false);
      showToast(signOutErrorMessage(error), 'error');
    });
  }, []);

  const confirmSignOut = React.useCallback(async () => {
    let pending = 0;
    try {
      pending = await getPendingCount();
    } catch {
      pending = 0;
    }
    if (pending > 0) {
      const changes = pending === 1 ? '1 change hasn’t' : `${pending} changes haven’t`;
      Alert.alert(
        'Unsynced changes',
        `${changes} synced yet. If you sign out now, ${pending === 1 ? 'it' : 'they'} will be lost. Connect to the internet first to keep ${pending === 1 ? 'it' : 'them'}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out anyway', style: 'destructive', onPress: runSignOut },
        ],
      );
      return;
    }
    Alert.alert('Sign out of Festie?', 'Your schedule and crews will be here when you sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: runSignOut },
    ]);
  }, [runSignOut]);

  const openSystemSettings = React.useCallback(() => {
    Linking.openSettings().catch(() => showToast("Couldn't open Settings. Open the Settings app and find Festie.", 'error'));
  }, []);

  const notificationRow =
    notifications === 'granted'
      ? { value: 'On', subtitle: 'Set and meetup reminders. Manage them in the Settings app.', onPress: openSystemSettings }
      : notifications === 'denied'
        ? { value: 'Off', subtitle: 'Turn on notifications in the Settings app to get reminders.', onPress: openSystemSettings }
        : notifications === 'undetermined'
          ? { value: 'Not set up', subtitle: "We'll ask the first time you set a reminder.", onPress: undefined }
          : { value: undefined, subtitle: 'Set and meetup reminders', onPress: openSystemSettings };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: screenTint }]} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        title="Settings"
        subtitle="Account & privacy"
        onBack={() => goBackOr(HOME_HREF)}
        backIcon={<Ionicons name="chevron-back" size={22} color={colors.textPrimary} />}
      />

      <ListSection title="Profile">
        {profile ? (
          <ListRow
            leading={<Avatar name={profile.display_name} avatarType={profile.avatar_type} avatarValue={profile.avatar_value} size={48} accessibilityLabel={null} />}
            title={profile.display_name}
            subtitle="Edit name and avatar"
            accessibilityLabel={`${profile.display_name}. Edit name and avatar`}
            onPress={() => router.push('/settings/profile')}
          />
        ) : (
          <ListRow title="Set up your profile" subtitle="Choose a name and avatar" onPress={() => router.push('/auth/profile-setup')} />
        )}
      </ListSection>

      <ListSection title="Privacy" footer="Your crew sees your location for at most 15 minutes after the last update, then it's deleted.">
        <ListRow
          title="Blocked users"
          subtitle="See and unblock people you've blocked"
          onPress={() => router.push('/settings/blocked-users')}
        />
        <ListRow
          title="Location sharing"
          value={sharingText.value}
          subtitle={sharingText.subtitle}
          onPress={
            sharing.status === 'permission_denied'
              ? sharing.canAskAgain
                ? () => void sharing.requestAccess()
                : openSystemSettings
              : undefined
          }
        />
        {sharing.status !== 'off' ? (
          <ListRow title="Stop sharing location" destructive loading={stoppingShare} onPress={confirmStopSharing} />
        ) : null}
      </ListSection>

      <ListSection title="Notifications">
        <ListRow
          title="Reminders"
          value={notificationRow.value}
          subtitle={notificationRow.subtitle}
          onPress={notificationRow.onPress}
          accessibilityHint={notificationRow.onPress ? 'Opens the Settings app' : undefined}
        />
      </ListSection>

      <ListSection title="About">
        <ListRow title="Privacy Policy" onPress={openPrivacyPolicy} />
        <ListRow title="Terms of Use" onPress={openTermsOfUse} />
        <ListRow
          title="Photo credits"
          subtitle="Who took the artist and festival photos"
          onPress={() => router.push('/settings/credits')}
        />
        {SUPPORT_EMAIL ? (
          <ListRow
            title="Contact support"
            subtitle={SUPPORT_EMAIL}
            onPress={() => openSupportEmail(`Festie support (${APP_VERSION_LABEL})`)}
            accessibilityHint="Opens your mail app"
          />
        ) : null}
        {SUPPORT_URL ? <ListRow title="Help & support" onPress={openSupportUrl} accessibilityHint="Opens in a browser" /> : null}
        <ListRow title="Version" value={APP_VERSION_LABEL} />
      </ListSection>

      <ListSection title="Account" footer="Deleting your account permanently removes your profile, crews you're alone in, meetups and photos.">
        <ListRow title="Delete account" destructive onPress={() => router.push('/settings/delete-account')} />
      </ListSection>

      <DestructiveButton label="Sign out" loading={signingOut} onPress={() => void confirmSignOut()} />
      <Text style={styles.footer}>Festie is an independent app and is not affiliated with any festival.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.xl, padding: spacing.lg, paddingBottom: spacing.xxxl + spacing.xl },
  footer: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
