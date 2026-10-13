import { createGroup, GROUP_NAME_MAX_LENGTH, toUserMessage, type CreatedGroup } from '@festival/data-access';
import {
  colors,
  continuous,
  FieldInput,
  FieldLabel,
  InlineMessage,
  layout,
  PrimaryButton,
  radii,
  SecondaryButton,
  SectionCard,
  spacing,
  tabularNums,
  TextLink,
  textStyles,
  upright,
  useOfflineStatus,
} from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { KeyboardAvoidingScreen } from '@/src/components/KeyboardAvoidingScreen';
import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { NoFestivalState } from '@/src/components/StateViews';
import { buildInviteShareMessage } from '@/src/config/app-info';
import { invalidateGroupQueries } from '@/src/hooks/query-keys';
import { useActiveFestival } from '@/src/hooks/use-festival';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

/** Dynamic Type cap on the large invite code (the same idea as the code field on the Join screen). */
const INVITE_CODE_MAX_SCALE = 1.5;

async function shareInvite(group: Pick<CreatedGroup, 'name' | 'invite_code'>): Promise<void> {
  try {
    await Share.share({ message: buildInviteShareMessage(group.name, group.invite_code) });
  } catch {
    // The share sheet was dismissed or is unavailable; the code stays on screen.
  }
}

export default function CreateGroupScreen() {
  const screenBg = useFestivalScreenTint();
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
    <KeyboardAvoidingScreen style={[styles.container, { backgroundColor: screenBg }]}>
      <SubScreenHeader title="Create a crew" label="Give your crew a name" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} keyboardShouldPersistTaps="handled">
        {!festivalId ? (
          <NoFestivalState onPick={() => router.navigate('/(tabs)/festivals')} />
        ) : created ? (
          <SectionCard>
            {/* Title and subtitle drawn here (not through SectionCard's props) so VoiceOver skips the ✦. */}
            <View style={styles.readyHeader}>
              <Text style={styles.readyTitle} accessibilityRole="header" accessibilityLabel="Crew is ready">
                Crew is ready ✦
              </Text>
              <Text style={styles.readySubtitle}>
                Share the code with your friends. They can type it in, or tap the link in your message.
              </Text>
            </View>
            <View style={styles.codeContainer} accessible accessibilityLabel={`Invite code ${created.invite_code.split('').join(' ')}`}>
              {/* One unbroken line: a wrap would split the code mid-word ("AB2CD" / "E") and read as a
                  different code. Growth is capped at 1.5× and anything still too wide shrinks to fit; the
                  container's label carries the full code for VoiceOver. */}
              <Text style={styles.codeValue} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={INVITE_CODE_MAX_SCALE}>
                {created.invite_code}
              </Text>
            </View>
            <PrimaryButton label="Share invite" onPress={() => void shareInvite(created)} />
            <SecondaryButton label="Go to crew" onPress={() => router.replace(`/(tabs)/group/${created.group_id}`)} />
          </SectionCard>
        ) : (
          <SectionCard subtitle="We'll generate a 6-character invite code your friends can use to join. Crews hold up to 50 people.">
            <View style={styles.festivalRow}>
              {/* One phrase ("For Coachella 2026") that wraps at large text sizes instead of truncating. */}
              <Text style={styles.festivalText}>
                <Text style={styles.festivalLabel}>For </Text>
                <Text style={styles.festivalName}>{festival?.name ?? 'the selected festival'}</Text>
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
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  /* The festival wash (`screenBg`) is applied inline; it is translucent over the Stack's `colors.background`. */
  container: { flex: 1 },
  content: { gap: spacing.md, padding: layout.screenGutter },
  readyHeader: { gap: spacing.sm },
  readyTitle: { ...textStyles.title2, color: colors.textPrimary },
  readySubtitle: { ...textStyles.subheadline, color: colors.textSecondary },
  festivalRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  festivalText: { ...textStyles.subheadline, flex: 1 },
  festivalLabel: { color: colors.textSecondary },
  festivalName: { color: colors.textPrimary, fontWeight: '600' },
  codeContainer: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  // Six characters at 34pt with 8pt tracking measure about 190–240pt, inside the ≈ 260pt this block has on
  // a 375pt phone. The Text stays on one line (capped growth, shrink-to-fit), so it stretches to the
  // block's full width to measure against all of it.
  codeValue: {
    ...textStyles.largeTitle,
    ...upright,
    ...tabularNums,
    alignSelf: 'stretch',
    color: colors.textPrimary,
    letterSpacing: 8,
    textAlign: 'center',
  },
});
