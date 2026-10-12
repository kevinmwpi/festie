import {
  createMeetup,
  MEETUP_NOTES_MAX_LENGTH,
  MEETUP_TITLE_MAX_LENGTH,
  toUserMessage,
  type LocalMeetup,
} from '@festival/data-access';
import { getFestivalCamera, type LngLat } from '@festival/map-utils';
import { scheduleMeetupReminder } from '@festival/notification-utils';
import {
  Chip,
  colors,
  EmptyState,
  FieldInput,
  FieldLabel,
  InlineMessage,
  layout,
  PrimaryButton,
  radii,
  SecondaryButton,
  SectionCard,
  showToast,
  spacing,
  TextLink,
} from '@festival/ui';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Mapbox from '@rnmapbox/maps';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SubScreenHeader } from '@/src/components/ScreenHeader';
import { ErrorState, LoadingState } from '@/src/components/StateViews';
import { isMapboxConfigured } from '@/src/config/app-info';
import { invalidateGroupQueries } from '@/src/hooks/query-keys';
import { useFestivalBundle, useFestivalClock } from '@/src/hooks/use-festival';
import { useGroupDetail } from '@/src/hooks/use-groups';
import { writeAndAwaitSync } from '@/src/hooks/sync-outcome';
import { useTabBarClearance } from '@/src/hooks/use-tab-bar-clearance';
import {
  chooseTotemSource,
  pickTotemPhoto,
  uploadPickedTotem,
  type PickedTotemPhoto,
} from '@/src/hooks/use-totem-photo';

/** Next quarter hour, one hour from now. */
function defaultStart(): Date {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15);
  return date;
}

export default function CreateMeetupScreen() {
  const tabBarClearance = useTabBarClearance();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = (Array.isArray(params.groupId) ? params.groupId[0] : params.groupId) ?? '';
  const queryClient = useQueryClient();

  const detail = useGroupDetail(groupId);
  const group = detail.data?.group ?? null;
  const bundle = useFestivalBundle(group?.festival_id ?? null);
  const festival = bundle.data?.festival ?? null;
  const stages = React.useMemo(
    () => [...(bundle.data?.stages ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [bundle.data],
  );
  const clock = useFestivalClock(festival);
  const camera = festival ? getFestivalCamera(festival) : null;
  const canPin = camera !== null && isMapboxConfigured();
  const pickerTimeZone = festival && !clock.deviceLocal ? festival.timezone : undefined;

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [stageId, setStageId] = React.useState<string | null>(null);
  const [startsAt, setStartsAt] = React.useState<Date>(defaultStart);
  const [pin, setPin] = React.useState<LngLat | null>(null);
  const [photo, setPhoto] = React.useState<PickedTotemPhoto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const openAndroidPicker = React.useCallback(
    (mode: 'date' | 'time') => {
      DateTimePickerAndroid.open({
        value: startsAt,
        mode,
        timeZoneName: pickerTimeZone,
        onChange: (event: DateTimePickerEvent, date?: Date) => {
          if (event.type === 'set' && date) setStartsAt(date);
        },
      });
    },
    [pickerTimeZone, startsAt],
  );

  const handleAddPhoto = React.useCallback(async () => {
    const source = await chooseTotemSource();
    if (!source) return;
    try {
      const picked = await pickTotemPhoto(source);
      if (picked) setPhoto(picked);
    } catch (pickError) {
      showToast(pickError instanceof Error ? pickError.message : toUserMessage(pickError), 'error');
    }
  }, []);

  const finishPhoto = React.useCallback(async (meetup: LocalMeetup, picked: PickedTotemPhoto) => {
    try {
      const outcome = await uploadPickedTotem(picked, meetup);
      if (outcome === 'not_synced') {
        await new Promise<void>((resolve) =>
          Alert.alert(
            'Meetup saved',
            "Add the photo once this meetup syncs — open it on the crew page and tap Add totem photo when you're back online.",
            [{ text: 'OK', onPress: () => resolve() }],
            { onDismiss: () => resolve() },
          ),
        );
      }
    } catch (uploadError) {
      await new Promise<void>((resolve) =>
        Alert.alert(
          "Meetup saved, photo didn't upload",
          `${toUserMessage(uploadError)} You can add the photo later from the crew page.`,
          [{ text: 'OK', onPress: () => resolve() }],
          { onDismiss: () => resolve() },
        ),
      );
    }
  }, []);

  const handleSave = React.useCallback(async () => {
    if (!group) return;
    setSaving(true);
    setError(null);
    try {
      // Online, wait briefly for the server: a rejection (e.g. the text filter, `content_not_allowed`)
      // is shown here instead of a success toast followed by a rollback.
      const { record: meetup, outcome } = await writeAndAwaitSync('meetups', () =>
        createMeetup({
          group_id: group.id,
          title: title.trim(),
          starts_at: startsAt.toISOString(),
          stage_id: stageId,
          notes: notes.trim() || null,
          latitude: pin ? pin[1] : null,
          longitude: pin ? pin[0] : null,
        }),
      );
      await invalidateGroupQueries(queryClient);
      if (outcome.status === 'failed') {
        // Rolled back locally; the form keeps the user's input so they can change it and save again.
        setError(toUserMessage({ code: outcome.failure.errorCode, message: outcome.failure.errorMessage ?? '' }));
        return;
      }

      if (festival) {
        const stageName = stageId ? stages.find((stage) => stage.id === stageId)?.name : null;
        // First meetup → contextual notification permission prompt; a denial is fine.
        await scheduleMeetupReminder(
          { id: meetup.id, title: meetup.title, starts_at: meetup.starts_at, place: stageName ?? null, group_id: group.id },
          { timeZone: festival.timezone },
        );
      }

      if (photo) {
        await finishPhoto(meetup, photo);
        await invalidateGroupQueries(queryClient);
      }
      showToast(outcome.status === 'synced' ? 'Meetup saved.' : 'Meetup saved — it syncs when you have signal.', 'success');
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace(`/(tabs)/group/${group.id}`);
      }
    } catch (saveError) {
      setError(toUserMessage(saveError));
    } finally {
      setSaving(false);
    }
  }, [festival, finishPhoto, group, notes, photo, pin, queryClient, stageId, stages, startsAt, title]);

  const header = <SubScreenHeader title="Create Meetup" label={group ? `${group.name} · plan your regroup spot`.toUpperCase() : 'PLAN YOUR REGROUP SPOT'} />;

  if (!group) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.content}>
          {detail.isLoading || detail.isRefreshing ? (
            <LoadingState label="Loading crew…" />
          ) : (
            detail.refreshError ? (
              <ErrorState error={detail.refreshError} onRetry={() => void detail.refetch()} />
            ) : (
              <EmptyState title="Crew unavailable" description="This crew isn't on this device. Go back and pull to refresh." />
            )
          )}
        </View>
      </View>
    );
  }

  const festivalTimeLabel = `${clock.date(startsAt.toISOString())} · ${clock.time(startsAt.toISOString())}`;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: tabBarClearance }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {header}
        <View style={styles.content}>
          <SectionCard subtitle="Meetups save on your phone first and sync to your crew when you have signal.">
            <FieldLabel>Title</FieldLabel>
            <FieldInput
              onChangeText={setTitle}
              placeholder="Sunset regroup"
              value={title}
              maxLength={MEETUP_TITLE_MAX_LENGTH}
              accessibilityLabel="Meetup title"
            />

            <FieldLabel>Date & time</FieldLabel>
            {Platform.OS === 'ios' ? (
              <View style={styles.iosPickerRow}>
                <DateTimePicker
                  mode="datetime"
                  display="compact"
                  value={startsAt}
                  timeZoneName={pickerTimeZone}
                  minuteInterval={5}
                  onChange={(_event: DateTimePickerEvent, date?: Date) => {
                    if (date) setStartsAt(date);
                  }}
                  accessibilityLabel="Meetup date and time"
                />
              </View>
            ) : (
              <View style={styles.androidPickerRow}>
                <Pressable
                  onPress={() => openAndroidPicker('date')}
                  accessibilityRole="button"
                  accessibilityLabel={`Date, ${clock.date(startsAt.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' })}`}
                  style={({ pressed }) => [styles.dateButton, pressed && styles.pressed]}
                >
                  <Text style={styles.dateButtonText}>{clock.date(startsAt.toISOString())}</Text>
                </Pressable>
                <Pressable
                  onPress={() => openAndroidPicker('time')}
                  accessibilityRole="button"
                  accessibilityLabel={`Time, ${clock.time(startsAt.toISOString())}`}
                  style={({ pressed }) => [styles.dateButton, pressed && styles.pressed]}
                >
                  <Text style={styles.dateButtonText}>{clock.time(startsAt.toISOString())}</Text>
                </Pressable>
              </View>
            )}
            {festival ? (
              <Text style={styles.hint}>
                {clock.deviceLocal ? festivalTimeLabel : `${festivalTimeLabel} festival time (${clock.label})`}
              </Text>
            ) : null}

            {stages.length > 0 ? (
              <>
                <FieldLabel>Stage (optional)</FieldLabel>
                <View style={styles.stageList}>
                  {stages.map((stage) => (
                    <Chip
                      key={stage.id}
                      label={stage.name}
                      active={stageId === stage.id}
                      onPress={() => setStageId((current) => (current === stage.id ? null : stage.id))}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {canPin && camera ? (
              <>
                <FieldLabel>Map pin (optional)</FieldLabel>
                <View style={styles.mapFrame}>
                  <Mapbox.MapView
                    style={styles.map}
                    styleURL={Mapbox.StyleURL.Street}
                    scaleBarEnabled={false}
                    compassEnabled={false}
                    onPress={(feature) => {
                      const [lng, lat] = feature.geometry.coordinates;
                      if (typeof lng === 'number' && typeof lat === 'number') setPin([lng, lat]);
                    }}
                    accessibilityLabel="Map. Tap to place the meetup pin."
                  >
                    <Mapbox.Camera
                      defaultSettings={
                        camera.bounds
                          ? { bounds: { ne: camera.bounds.ne, sw: camera.bounds.sw } }
                          : { centerCoordinate: camera.center, zoomLevel: camera.zoom }
                      }
                    />
                    {pin ? (
                      <Mapbox.MarkerView coordinate={pin} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
                        <View style={styles.pin} />
                      </Mapbox.MarkerView>
                    ) : null}
                  </Mapbox.MapView>
                </View>
                {pin ? (
                  <TextLink label="Clear pin" onPress={() => setPin(null)} />
                ) : (
                  <Text style={styles.hint}>Tap the map to drop a pin where you'll meet.</Text>
                )}
              </>
            ) : null}

            <FieldLabel>Notes (optional)</FieldLabel>
            <FieldInput
              multiline
              numberOfLines={3}
              onChangeText={setNotes}
              placeholder="Look for the giant flamingo."
              value={notes}
              maxLength={MEETUP_NOTES_MAX_LENGTH}
              style={styles.notesInput}
              accessibilityLabel="Notes, optional"
            />

            <FieldLabel>Totem photo (optional)</FieldLabel>
            {photo ? (
              <>
                <Image source={{ uri: photo.uri }} style={styles.preview} accessibilityLabel="Selected totem photo" />
                <View style={styles.photoActions}>
                  <TextLink label="Replace photo" onPress={() => void handleAddPhoto()} />
                  <TextLink label="Remove photo" onPress={() => setPhoto(null)} />
                </View>
              </>
            ) : (
              <SecondaryButton label="Add totem photo" onPress={() => void handleAddPhoto()} />
            )}

            <InlineMessage message={error} />
            <PrimaryButton
              disabled={saving || title.trim().length === 0}
              label="Save meetup"
              loading={saving}
              onPress={() => void handleSave()}
            />
          </SectionCard>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.md, paddingHorizontal: spacing.lg },
  pressed: { opacity: 0.8 },
  iosPickerRow: { alignItems: 'flex-start' },
  androidPickerRow: { flexDirection: 'row', gap: spacing.sm },
  dateButton: {
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget + 4,
    paddingHorizontal: spacing.md,
  },
  dateButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  stageList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notesInput: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  mapFrame: { borderRadius: radii.xl, height: 220, overflow: 'hidden' },
  map: { flex: 1 },
  pin: {
    backgroundColor: colors.link,
    borderColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 3,
    height: 24,
    width: 24,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  preview: { borderRadius: radii.xl, height: 180, resizeMode: 'cover', width: '100%' },
  photoActions: { flexDirection: 'row', gap: spacing.lg },
});
