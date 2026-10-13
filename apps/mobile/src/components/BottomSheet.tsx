import { Ionicons } from '@expo/vector-icons';
import { colors, continuous, elevation, IconButton, layout, radii, spacing, textStyles } from '@festival/ui';
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom sheet: a white `card`-radius surface over a dimmed backdrop, with a grabber, an optional
 * `title2` title and a close button. Tapping the backdrop, the close button, the hardware back button or
 * the VoiceOver escape gesture (two-finger Z) closes it. `showCloseButton={false}` is for sheets that end
 * in their own Cancel row (`ActionSheet`).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  showCloseButton = true,
  children,
}: React.PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  showCloseButton?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
        >
          <View style={styles.grabber} importantForAccessibility="no" accessibilityElementsHidden />
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {title || showCloseButton ? (
              <View style={styles.headerRow}>
                <View style={styles.headerText}>
                  {title ? (
                    <Text style={styles.title} accessibilityRole="header">
                      {title}
                    </Text>
                  ) : null}
                  {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>
                {showCloseButton ? (
                  <IconButton
                    icon={<Ionicons name="close" size={20} color={colors.textPrimary} />}
                    accessibilityLabel="Close"
                    onPress={onClose}
                  />
                ) : null}
              </View>
            ) : subtitle ? (
              <Text style={styles.subtitle}>{subtitle}</Text>
            ) : null}
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface SheetAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /** Screen-reader hint, e.g. "Asks for confirmation". */
  hint?: string;
}

/** A list of actions in a bottom sheet (cross-platform; Android alerts allow only three buttons). */
export function ActionSheet({
  visible,
  title,
  message,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={message} showCloseButton={false}>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={() => {
              onClose();
              // Let the sheet start closing before the next sheet/alert opens (iOS presents one modal at a time).
              setTimeout(action.onPress, Platform.OS === 'ios' ? 350 : 0);
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityHint={action.hint}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            <Text style={[styles.actionLabel, action.destructive && styles.actionDestructive]}>{action.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={({ pressed }) => [styles.action, styles.cancel, pressed && styles.actionPressed]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim },
  sheet: {
    ...continuous,
    ...elevation.floating,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    maxHeight: '88%',
    paddingHorizontal: layout.cardPadding,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    backgroundColor: colors.fillStrong,
    borderRadius: radii.xs,
    height: 5,
    marginBottom: spacing.xs,
    width: 36,
  },
  content: { gap: spacing.md, paddingBottom: spacing.sm },
  headerRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.ms },
  headerText: { flex: 1, gap: spacing.xs, paddingTop: spacing.sm },
  title: { ...textStyles.title2, color: colors.textPrimary },
  subtitle: { ...textStyles.subheadline, color: colors.textSecondary },
  actions: { gap: spacing.sm },
  action: {
    ...continuous,
    alignItems: 'center',
    backgroundColor: colors.fill,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: layout.buttonHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.ms,
  },
  actionPressed: { backgroundColor: colors.fillStrong },
  actionLabel: { ...textStyles.headline, color: colors.textPrimary, textAlign: 'center' },
  actionDestructive: { color: colors.destructive },
  cancel: { backgroundColor: colors.surface, borderColor: colors.separator, borderWidth: 1, marginTop: spacing.xs },
  cancelLabel: { ...textStyles.headline, color: colors.link, textAlign: 'center' },
});
