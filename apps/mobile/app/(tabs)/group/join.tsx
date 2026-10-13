import { isWellFormedInviteCode, joinGroup, normaliseInviteCode, toUserMessage } from '@festival/data-access';
import {
  FieldInput,
  FieldLabel,
  InlineMessage,
  layout,
  PrimaryButton,
  SectionCard,
  spacing,
  tabularNums,
  textStyles,
  upright,
  useOfflineStatus,
} from '@festival/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { KeyboardAvoidingScreen } from '@/src/components/KeyboardAvoidingScreen';
import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { invalidateGroupQueries } from '@/src/hooks/query-keys';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default function JoinGroupScreen() {
  const screenBg = useFestivalScreenTint();
  const tabBarClearance = useTabBarClearance();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const queryClient = useQueryClient();
  const isOffline = useOfflineStatus();
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);
  // Pre-filled from an invite link; the user still confirms (never auto-joins).
  const [inviteCode, setInviteCode] = React.useState(() => normaliseInviteCode(firstParam(params.code)).slice(0, 6));
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const paramCode = firstParam(params.code);
  React.useEffect(() => {
    if (paramCode) {
      setInviteCode(normaliseInviteCode(paramCode).slice(0, 6));
      setError(null);
    }
  }, [paramCode]);

  const wellFormed = isWellFormedInviteCode(inviteCode);

  const handleJoin = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await joinGroup(inviteCode);
      setSelectedGroupId(result.group_id);
      await invalidateGroupQueries(queryClient);
      router.replace(`/(tabs)/group/${result.group_id}`);
    } catch (joinError) {
      // InviteNotFoundError, rate_limited and group_full all map to specific copy.
      setError(toUserMessage(joinError));
    } finally {
      setLoading(false);
    }
  }, [inviteCode, queryClient, setSelectedGroupId]);

  return (
    <KeyboardAvoidingScreen style={[styles.container, { backgroundColor: screenBg }]}>
      <SubScreenHeader title="Join a crew" label="Enter your invite code" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} keyboardShouldPersistTaps="handled">
        <SectionCard subtitle="Codes are 6 letters and numbers. Paste or type the code a friend sent you.">
          <FieldLabel>Invite code</FieldLabel>
          <FieldInput
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            onChangeText={(text) => {
              setInviteCode(normaliseInviteCode(text).slice(0, 6));
              setError(null);
            }}
            placeholder="AB12CD"
            value={inviteCode}
            style={styles.codeInput}
            // A single-line field scrolls sideways instead of wrapping: capped so all six characters stay
            // visible at the largest text sizes (the field still grows to 1.6×).
            maxFontSizeMultiplier={1.6}
            accessibilityLabel="Invite code"
            returnKeyType="go"
            onSubmitEditing={() => {
              if (wellFormed && !loading) void handleJoin();
            }}
          />
          {inviteCode.length === 6 && !wellFormed ? (
            <InlineMessage message="That doesn't look like a Festie code. Check it and try again." />
          ) : null}
          {isOffline ? <InlineMessage tone="muted" message="Joining a crew needs a connection." /> : null}
          <InlineMessage message={error} />
          <PrimaryButton disabled={loading || !wellFormed} label="Join crew" loading={loading} onPress={() => void handleJoin()} />
        </SectionCard>
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  /* The festival wash (`screenBg`) is applied inline; it is translucent over the Stack's `colors.background`. */
  container: { flex: 1 },
  content: { gap: spacing.md, padding: layout.screenGutter },
  codeInput: {
    ...textStyles.title2,
    ...upright,
    ...tabularNums,
    letterSpacing: 6,
    textAlign: 'center',
  },
});
