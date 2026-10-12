import { deriveAccentColors } from '@festival/ui';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { useAppStore } from '@/src/state/app-store';

/**
 * Washes registered for the root safe-area edge (the strip behind the status bar), one per focused
 * screen. The most recently focused one wins, whatever order focus and blur events arrive in.
 */
const edgeTints = createStore<{ tints: Array<{ id: number; color: string }> }>(() => ({ tints: [] }));
let nextEdgeTintId = 0;

/**
 * Paints the root safe-area edge with `color` while the calling screen is focused. The root draws it
 * over the same `colors.background` the screen's own wash sits on, so a tinted screen runs into the
 * top corners instead of ending at a pale band under the status bar.
 */
export function useSafeAreaEdgeTint(color: string): void {
  const [id] = React.useState(() => nextEdgeTintId++);
  useFocusEffect(
    React.useCallback(() => {
      edgeTints.setState((state) => ({ tints: [...state.tints.filter((tint) => tint.id !== id), { id, color }] }));
      return () => edgeTints.setState((state) => ({ tints: state.tints.filter((tint) => tint.id !== id) }));
    }, [id, color]),
  );
}

/** The wash for the root safe-area edge, or null to leave it `colors.background`. */
export function useSafeAreaEdgeColor(): string | null {
  return useStore(edgeTints, (state) => state.tints[state.tints.length - 1]?.color ?? null);
}

/**
 * Screen wash for the active festival (the same `bgTint` the tabs use), so screens outside the tabs —
 * Settings — keep the festival's colour when pushed over them. Drawn over `colors.background`. It also
 * paints the status bar strip while the screen is focused.
 */
export function useFestivalScreenTint(): string {
  const accent = useAppStore((state) => state.activeFestivalAccent);
  const tint = deriveAccentColors(accent).bgTint;
  useSafeAreaEdgeTint(tint);
  return tint;
}
