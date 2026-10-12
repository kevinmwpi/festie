import { layout } from '@festival/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding that keeps the end of a tab screen's content clear of the floating tab bar. Screens run
 * to the bottom edge of the display (the root insets only the status bar), and the bar floats above the
 * home indicator, so the clearance includes the bottom inset.
 */
export function useTabBarClearance(): number {
  return layout.tabBarClearance + useSafeAreaInsets().bottom;
}
