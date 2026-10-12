import { createGroup, GROUP_NAME_MAX_LENGTH, toUserMessage, type CreatedGroup } from '@festival/data-access';
import {
  colors,
  FieldInput,
  FieldLabel,
  InlineMessage,
  PrimaryButton,
  radii,
  SecondaryButton,
  SectionCard,
  spacing,
  TextLink,
  useOfflineStatus,
} from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { NoFestivalState } from '@/src/components/StateViews';
import { buildInviteShareMessage } from '@/src/config/app-info';
import { invalidateGroupQueries } from '@/src/hooks/query-keys';
import { useActiveFestival } from '@/src/hooks/use-festival';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useAppStore } from '@/src/state/app-store';

async function shareInvite(group: Pick<CreatedGroup, 'name' | 'invite_code'>): Promise<void> {
  try {
    await Share.share({ message: buildInviteShareMessage(group.name, group.invite_code) });
  } catch {
    // The share sheet was dismissed or is unavailable; the code stays on screen.
  }
}

export default function CreateGroupScreen() {
  const tabBarClearance = useTabBarClearance();
  const queryClient = useQueryClient();
  const isOffline = useOfflineStatus();
  const { festivalId, festival } = useActiveFestival();
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreatedGroup | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleCreate = React.useCallback(async () => {
    if (!festivalId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const group = await createGroup({ name: name.trim(), festival_id: festivalId });
      setCreated(group);
      setSelectedGroupId(group.group_id);
      await invalidateGroupQueries(queryClient);
      // Straight to the share sheet (§5.4); the code also stays on screen.
      await shareInvite(group);
    } catch (createError) {
      setError(toUserMessage(createError));
    } finally {
      setLoading(false);
    }
  }, [festivalId, name, queryClient, setSelectedGroupId]);

  return (
    <View style={styles.container}>
      <SubScreenHeader title="Create a Crew" label="Give your crew a name" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} keyboardShouldPersistTaps="handled">
        {!festivalId ? (
          <NoFestivalState onPick={() => router.navigate('/(tabs)/festivals')} />
        ) : created ? (
          <SectionCard title="Crew is ready ✦" subtitle="Share the code with your friends. They can type it in, or tap the link in your message.">
            <View style={styles.codeContainer} accessible accessibilityLabel={`Invite code ${created.invite_code.split('').join(' ')}`}>
              <Text style={styles.codeValue}>{created.invite_code}</Text>
            </View>
            <PrimaryButton label="Share invite" onPress={() => void shareInvite(created)} />
            <SecondaryButton label="Go to crew" onPress={() => router.replace(`/(tabs)/group/${created.group_id}`)} />
          </SectionCard>
        ) : (
          <SectionCard subtitle="We'll generate a 6-character invite code your friends can use to join. Crews hold up to 50 people.">
            <View style={styles.festivalRow}>
              <Text style={styles.festivalLabel}>For</Text>
              <Text style={styles.festivalName} numberOfLines={1}>
                {festival?.name ?? 'the selected festival'}
              </Text>
              <TextLink label="Change" onPress={() => router.navigate('/(tabs)/festivals')} accessibilityLabel="Change festival" />
            </View>
            <FieldLabel>Crew name</FieldLabel>
            <FieldInput
              onChangeText={setName}
              placeholder="Campfire Friends"
              value={name}
              maxLength={GROUP_NAME_MAX_LENGTH}
              autoCapitalize="words"
              returnKeyType="done"
              accessibilityLabel="Crew name"
            />
            {isOffline ? <InlineMessage tone="muted" message="Creating a crew needs a connection." /> : null}
            <InlineMessage message={error} />
            <PrimaryButton
              disabled={loading || name.trim().length === 0}
              label="Create crew"
              loading={loading}
              onPress={() => void handleCreate()}
            />
          </SectionCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg },
  festivalRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  festivalLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  festivalName: { color: colors.textPrimary, flex: 1, fontSize: 15, fontWeight: '700' },
  codeContainer: {
    backgroundColor: '#F0F4FF',
    borderRadius: radii.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  codeValue: {
    color: colors.textPrimary,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 8,
    textAlign: 'center',
  },
});
