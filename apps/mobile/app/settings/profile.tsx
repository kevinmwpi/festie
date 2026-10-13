import { colors, InlineMessage, layout, PrimaryButton, ScreenHeader, SectionCard, showToast, spacing } from '@festival/ui';
import { usePreventRemove } from '@react-navigation/native';
import { useNavigation } from 'expo-router';
import React from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { KeyboardAvoidingScreen } from '@/src/components/KeyboardAvoidingScreen';
import { goBackOr } from '@/src/providers/launch-route';
import { ProfileFields, useProfileForm } from '@/src/providers/profile-form';
import { useCachedProfile } from '@/src/providers/session-state';
import { useFestivalScreenTint } from '@/src/providers/screen-tint';

export default function EditProfileScreen() {
  const screenTint = useFestivalScreenTint();
  const profile = useCachedProfile();
  // The form starts from the profile as it was when the screen opened.
  const [initial] = React.useState(profile);
  const form = useProfileForm(initial);
  const navigation = useNavigation();
  const [saved, setSaved] = React.useState(false);

  // Ask before throwing away unsaved edits (back button, swipe back).
  usePreventRemove(form.dirty && !saved && !form.saving, ({ data }) => {
    Alert.alert('Discard changes?', "Your profile changes haven't been saved.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  React.useEffect(() => {
    if (saved) goBackOr('/settings');
  }, [saved]);

  const handleSave = React.useCallback(async () => {
    const result = await form.save();
    if (result) {
      showToast('Profile updated', 'success');
      setSaved(true);
    }
  }, [form]);

  return (
    <KeyboardAvoidingScreen style={[styles.screen, { backgroundColor: screenTint }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Edit profile" subtitle="How your crew sees you" onBack={() => goBackOr('/settings')} />
        <SectionCard>
          <ProfileFields form={form} />
        </SectionCard>
        <InlineMessage message={form.error} />
        <PrimaryButton
          label="Save changes"
          loading={form.saving}
          disabled={!form.dirty || !form.nameValid}
          onPress={() => void handleSave()}
        />
      </ScrollView>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: layout.screenGutter, paddingBottom: spacing.xxxl + spacing.xl },
});
