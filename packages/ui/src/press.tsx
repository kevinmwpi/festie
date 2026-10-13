import React, { useRef, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { motion } from './theme';

/* ─── Reduce Motion ─────────────────────────────────────── */

let reduceMotionEnabled = false;
let reduceMotionSubscribed = false;
const reduceMotionListeners = new Set<() => void>();

function setReduceMotion(enabled: boolean): void {
  if (enabled !== reduceMotionEnabled) {
    reduceMotionEnabled = enabled;
    reduceMotionListeners.forEach((listener) => listener());
  }
}

/** One app-wide subscription to the system setting, shared by every caller. */
function ensureReduceMotionSubscription(): void {
  if (reduceMotionSubscribed) {
    return;
  }
  reduceMotionSubscribed = true;
  void AccessibilityInfo.isReduceMotionEnabled()
    .then(setReduceMotion)
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
}

function subscribeToReduceMotion(listener: () => void): () => void {
  ensureReduceMotionSubscription();
  reduceMotionListeners.add(listener);
  return () => {
    reduceMotionListeners.delete(listener);
  };
}

const getReduceMotion = () => reduceMotionEnabled;

/** `true` while the system Reduce Motion setting is on: replace movement with a fade, or skip it. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribeToReduceMotion, getReduceMotion, getReduceMotion);
}

/** Current Reduce Motion value outside React (e.g. inside an animation callback). */
export function isReduceMotionEnabled(): boolean {
  ensureReduceMotionSubscription();
  return reduceMotionEnabled;
}

/* ─── PressableScale ────────────────────────────────────── */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /** A static style. Its own `opacity` (e.g. a disabled 0.5) is kept and dimmed further while pressed. */
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed (default `motion.pressedScale`). Pass 1 for opacity-only feedback. */
  pressedScale?: number;
  /** Opacity multiplier while pressed (default `motion.pressedOpacity`). */
  pressedOpacity?: number;
}

/**
 * The one press behaviour for buttons, chips, tiles and cards: on touch-down it springs to a slightly
 * smaller, dimmer state at once; on release it settles back. Native-driven (transform + opacity only).
 * With Reduce Motion on, only the opacity changes. Do not put a `transform` in `style`; it would be
 * replaced by the press scale.
 */
export function PressableScale({
  style,
  pressedScale = motion.pressedScale,
  pressedOpacity = motion.pressedOpacity,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const styleOpacity = StyleSheet.flatten(style)?.opacity;
  const restOpacity = typeof styleOpacity === 'number' ? styleOpacity : 1;

  const animateTo = (toValue: 0 | 1) => {
    Animated.spring(progress, {
      toValue,
      useNativeDriver: true,
      ...(toValue === 1 ? motion.pressIn : motion.pressOut),
    }).start();
  };

  const scale = reduceMotion || pressedScale === 1
    ? 1
    : progress.interpolate({ inputRange: [0, 1], outputRange: [1, pressedScale] });
  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [restOpacity, restOpacity * pressedOpacity],
  });

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event: GestureResponderEvent) => {
        animateTo(1);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        animateTo(0);
        onPressOut?.(event);
      }}
      style={[style, { opacity, transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
