import {
  FESTIVAL_SUGGESTION_NAME_MAX_LENGTH,
  FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH,
  suggestFestival,
  toSuggestionErrorMessage,
} from '@festival/data-access';
import {
  colors,
  deriveAccentColors,
  FieldInput,
  FieldLabel,
  InlineMessage,
  PrimaryButton,
  SectionCard,
  showToast,
  spacing,
  useOfflineStatus,
} from '@festival/ui';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import { goBackOr, HOME_HREF } from '@/src/providers/launch-route';
import { useSafeAreaEdgeTint } from '@/src/providers/screen-tint';
import { useAppStore } from '@/src/state/app-store';

/**
 * "Suggest a festival" (from the Fests list): name, optional official website and note, sent with
 * `suggestFestival` (online only — the button is disabled offline with a hint).
 */
export default function SuggestFestivalScreen() {
  const tabBarClearance = useTabBarClearance();
  const accent = useAppStore((state) => state.activeFestivalAccent);
  const screenBg = deriveAccentColors(accent).bgTint;
  useSafeAreaEdgeTint(screenBg);
  const isOffline = useOfflineStatus();

  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  const noteLength = Array.from(note).length;
  const canSend = !isOffline && !sending && name.trim().length > 0;

  const handleSend = React.useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      await suggestFestival({ name, url, note });
      showToast("Thanks — we'll check it out.", 'success');
      goBackOr(HOME_HREF);
    } catch (sendError) {
      setError(toSuggestionErrorMessage(sendError));
    } finally {
      setSending(false);
    }
  }, [name, note, url]);

  return (
    <View style={[styles.container, { backgroundColor: screenBg }]}>
      <SubScreenHeader title="Suggest a festival" label="Don't see yours?" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SectionCard subtitle="Tell us which festival to add. Festie builds schedules from official published sources, so a link to the festival's website helps.">
          <FieldLabel>Festival name</FieldLabel>
          <FieldInput
            value={name}
            onChangeText={setName}
            placeholder="Festival name"
            maxLength={FESTIVAL_SUGGESTION_NAME_MAX_LENGTH}
            autoCapitalize="words"
            returnKeyType="next"
            accessibilityLabel="Festival name"
          />

          <FieldLabel>Official website (optional)</FieldLabel>
          <FieldInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            keyboardType="url"
            textContentType="URL"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            accessibilityLabel="Official website, optional"
          />

          <FieldLabel>Anything else? (optional)</FieldLabel>
          <FieldInput
            value={note}
            onChangeText={setNote}
            placeholder="Dates, city, what makes it special…"
            maxLength={FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH}
            multiline
            textAlignVertical="top"
            style={styles.noteInput}
            accessibilityLabel="Anything else, optional"
          />
          <Text style={styles.counter} accessibilityLabel={`${noteLength} of ${FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH} characters`}>
            {`${noteLength}/${FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH}`}
          </Text>

          {isOffline ? <InlineMessage tone="muted" message="Connect to send a suggestion." /> : null}
          <InlineMessage message={error} />
          <PrimaryButton label="Send suggestion" onPress={() => void handleSend()} disabled={!canSend} loading={sending} />
        </SectionCard>

        <Text style={styles.footnote}>
          We read every suggestion but can't reply to each one. A festival appears in Festie once its official schedule is
          published.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg },
  noteInput: { minHeight: 96 },
  counter: { alignSelf: 'flex-end', color: colors.textSecondary, fontSize: 12 },
  footnote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, paddingHorizontal: spacing.sm, textAlign: 'center' },
});
