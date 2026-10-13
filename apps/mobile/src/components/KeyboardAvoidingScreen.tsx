import React from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  StyleSheet,
  View,
  type KeyboardEvent,
  type KeyboardMetrics,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * Keeps a whole form screen above the keyboard on iOS (Android resizes the window itself).
 *
 * React Native's `KeyboardAvoidingView` compares the keyboard's screen position with the view's frame
 * *relative to its parent*, so a screen below the status bar (and the offline banner) under-compensates by
 * that distance and the bottom of the form stays behind the keyboard; a measured `keyboardVerticalOffset`
 * would race the keyboard of an `autoFocus` field. Instead, this measures its own window position at every
 * keyboard event and pads its content by the real overlap, animated with the keyboard's own curve.
 */
export function KeyboardAvoidingScreen({ style, children }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const frameRef = React.useRef<View>(null);
  const [inset, setInset] = React.useState(0);

  React.useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }

    const apply = (metrics: KeyboardMetrics | null, event?: KeyboardEvent) => {
      const node = frameRef.current;
      if (!node) {
        return;
      }
      const animate = () => {
        if (event?.duration) {
          LayoutAnimation.configureNext({
            duration: Math.max(event.duration, 10),
            update: { duration: Math.max(event.duration, 10), type: LayoutAnimation.Types[event.easing] ?? 'keyboard' },
          });
        }
      };
      if (!metrics) {
        animate();
        setInset(0);
        return;
      }
      node.measureInWindow((_x, y, _width, height) => {
        const overlap = Math.max(0, y + height - metrics.screenY);
        setInset((current) => {
          if (Math.abs(current - overlap) < 0.5) {
            return current;
          }
          animate();
          return overlap;
        });
      });
    };

    const show = Keyboard.addListener('keyboardWillShow', (event) => apply(event.endCoordinates, event));
    const change = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      if (Keyboard.isVisible()) {
        apply(event.endCoordinates, event);
      }
    });
    const hide = Keyboard.addListener('keyboardWillHide', (event) => apply(null, event));

    // An `autoFocus` field can raise the keyboard before this effect subscribes.
    if (Keyboard.isVisible()) {
      const metrics = Keyboard.metrics();
      if (metrics) {
        apply(metrics);
      }
    }

    return () => {
      show.remove();
      change.remove();
      hide.remove();
    };
  }, []);

  // `style` lays out the content (background, centring, padding), as it did on KeyboardAvoidingView; the
  // keyboard overlap is added to its own bottom padding.
  const flat = StyleSheet.flatten(style) ?? {};
  const basePadding = typeof flat.paddingBottom === 'number' ? flat.paddingBottom : typeof flat.paddingVertical === 'number' ? flat.paddingVertical : typeof flat.padding === 'number' ? flat.padding : 0;

  return (
    <View ref={frameRef} style={styles.fill} collapsable={false}>
      <View style={[styles.fill, style, { paddingBottom: basePadding + inset }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
