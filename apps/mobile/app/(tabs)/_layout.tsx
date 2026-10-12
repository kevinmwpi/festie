import { Ionicons } from '@expo/vector-icons';
import { configureReminderNotifications } from '@festival/notification-utils';
import { colors } from '@festival/ui';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSyncEventBridge } from '@/src/hooks/use-sync-events';
import { useAppStore } from '@/src/state/app-store';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Unfocused tab ink. `colors.textSecondary` (70 %) is tuned for white and tinted surfaces; on the solid
 * accent fill its 9 px labels drop to ~3.6:1. At 85 % the labels stay ≥ 4.9:1 on every accent
 * `accessibleAccent` can produce (§5.8) while still reading lighter than the focused tab.
 */
const UNFOCUSED_TAB_INK = 'rgba(44, 51, 39, 0.85)';

/** The floating pill's height; the icon + label stack is centred in it. */
const TAB_BAR_HEIGHT = 80;
/**
 * Box React Navigation gives each tab icon. Its default (31×28) is sized for a bare glyph; ours stacks a
 * 26 pt glyph, a gap and a label (≈ 41 pt, 1.1× when focused), which would overflow it and the pill.
 */
const TAB_ICON_BOX_HEIGHT = 52;
/** Space between the floating pill and the home indicator area below it. */
const TAB_BAR_GAP = 24;
/**
 * Screens run to the bottom edge of the display (app/_layout.tsx insets only the status bar). The pill
 * places itself above the home indicator with its bottom margin, so React Navigation adds no inset.
 */
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const TAB_CONFIG: Record<string, { icon: IoniconName; iconFocused: IoniconName; label: string }> = {
  festivals: { icon: 'flag-outline',          iconFocused: 'flag',           label: 'Fests'    },
  lineup:    { icon: 'musical-notes-outline', iconFocused: 'musical-notes',  label: 'Lineup'   },
  schedule:  { icon: 'calendar-outline',      iconFocused: 'calendar',       label: 'Schedule' },
  group:     { icon: 'people-outline',        iconFocused: 'people',         label: 'Crews'    },
  map:       { icon: 'map-outline',           iconFocused: 'map',            label: 'Map'      },
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const cfg = TAB_CONFIG[name];
  if (!cfg) return null;
  // Dark ink on the pastel accent keeps ≥ 4.5:1; unfocused tabs read as lighter ink, not lower opacity.
  const tint = focused ? colors.textPrimary : UNFOCUSED_TAB_INK;
  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerFocused]}>
      <Ionicons name={focused ? cfg.iconFocused : cfg.icon} size={26} color={tint} />
      <Text style={[styles.iconLabel, { color: tint }, focused && styles.iconLabelFocused]} allowFontScaling={false}>
        {cfg.label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  // Tab bar background = selected festival accent colour (fill only), as in the reference.
  const accent = useAppStore((s) => s.activeFestivalAccent);
  const insets = useSafeAreaInsets();

  useSyncEventBridge();
  React.useEffect(() => {
    configureReminderNotifications();
  }, []);

  return (
    <Tabs
      safeAreaInsets={NO_INSETS}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        // Centre each tab (React Navigation top-aligns them) in the full height of the pill.
        tabBarItemStyle: { justifyContent: 'center', paddingVertical: 0 },
        tabBarIconStyle: { width: '100%', height: TAB_ICON_BOX_HEIGHT },
        tabBarStyle: {
          backgroundColor: accent,
          borderTopWidth: 0,
          borderRadius: 32,
          height: TAB_BAR_HEIGHT,
          paddingTop: 0,
          paddingBottom: 0,
          marginHorizontal: 20,
          marginBottom: TAB_BAR_GAP + insets.bottom,
          position: 'absolute',
          shadowColor: '#000000',
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
          // subtle white border as in reference: border border-white/20
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.2)',
        },
      }}
    >
      <Tabs.Screen name="festivals" options={{ title: 'Fests',    tabBarIcon: ({ focused }) => <TabIcon name="festivals" focused={focused} /> }} />
      <Tabs.Screen name="lineup"    options={{ title: 'Lineup',   tabBarIcon: ({ focused }) => <TabIcon name="lineup"    focused={focused} /> }} />
      <Tabs.Screen name="schedule"  options={{ title: 'Schedule', tabBarIcon: ({ focused }) => <TabIcon name="schedule"  focused={focused} /> }} />
      <Tabs.Screen name="group"     options={{ title: 'Crews',    tabBarIcon: ({ focused }) => <TabIcon name="group"     focused={focused} /> }} />
      <Tabs.Screen name="map"       options={{ title: 'Map',      tabBarIcon: ({ focused }) => <TabIcon name="map"       focused={focused} /> }} />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
  },
  iconContainerFocused: {
    transform: [{ scale: 1.1 }],
  },
  iconLabel: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  iconLabelFocused: {
    fontWeight: '800',
  },
});
