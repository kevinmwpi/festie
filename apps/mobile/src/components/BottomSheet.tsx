import { Ionicons } from '@expo/vector-icons';
import { colors, layout, radii, spacing } from '@festival/ui';
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
 * Bottom sheet in the app's card language (40px top corners, white surface over a dimmed backdrop).
 * Tapping the backdrop or the hardware back button closes it.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: React.PropsWithChildren<{ visible: boolean; onClose: () => void; title?: string; subtitle?: string }>) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.sm }]}
          accessibilityViewIsModal
          // VoiceOver's two-finger Z gesture; the backdrop button is unreachable from inside a modal view.
          onAccessibilityEscape={onClose}
        >
          <View style={styles.grabber} importantForAccessibility="no" />
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {title ? (
              <View style={styles.titleRow}>
                <Text style={[styles.title, styles.titleText]} accessibilityRole="header">
                  {title}
                </Text>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  hitSlop={4}
                  style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="close" size={22} color={colors.textPrimary} />
                </Pressable>
              </View>
            ) : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={message}>
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20, 24, 18, 0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    maxHeight: '88%',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  grabber: {
    alignSelf: 'center',
    backgroundColor: 'rgba(44, 51, 39, 0.18)',
    borderRadius: 3,
    height: 5,
    marginBottom: spacing.sm,
    width: 40,
  },
  content: { gap: spacing.md, paddingBottom: spacing.sm },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  titleText: { flex: 1 },
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#F6F7F5',
    borderRadius: layout.minTouchTarget / 2,
    height: layout.minTouchTarget,
    justifyContent: 'center',
    marginTop: -spacing.xs,
    width: layout.minTouchTarget,
  },
  title: { color: colors.textPrimary, fontFamily: 'Georgia', fontSize: 24, fontStyle: 'italic', fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: -spacing.xs },
  actions: { gap: spacing.sm },
  action: {
    alignItems: 'center',
    backgroundColor: '#F6F7F5',
    borderRadius: radii.md + 4,
    justifyContent: 'center',
    minHeight: layout.minTouchTarget + 8,
    paddingHorizontal: spacing.md,
  },
  actionPressed: { opacity: 0.7 },
  actionLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  actionDestructive: { color: colors.destructive },
  cancel: { backgroundColor: colors.surface, borderColor: colors.borderCard, borderWidth: 1, marginTop: spacing.xs },
  cancelLabel: { color: colors.link, fontSize: 16, fontWeight: '700' },
});
