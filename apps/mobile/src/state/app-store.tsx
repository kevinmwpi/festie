/**
 * App-level UI state shared across tabs: the active festival (and its accent, which drives the
 * tab bar and screen tints) and the selected crew. Persisted in MMKV so a cold start — including
 * one with no signal — reopens on the same festival.
 *
 * The store is a module singleton so non-React code (sign-out, location sharing) can read and
 * reset it; `AppStoreProvider` exposes the same instance to components.
 */
import { getLocalFestival, getLocalFestivals, getLocalUserFestivals, type Festival } from '@festival/data-access';
import { accessibleAccent } from '@festival/ui';
import React, { createContext, useContext, useEffect } from 'react';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { localTodayKey, pickDefaultFestival } from './default-festival';

/** Accent used until a festival is chosen (matches the default soft-pink screen background). */
export const DEFAULT_ACCENT = '#FFB3D9';

const STORAGE_ID = 'app-store';
const STORAGE_KEY = 'state';
/** v2 added `activeFestivalSource`; a v1 record is read with the source `'default'`. */
const STORAGE_VERSION = 2;
const READABLE_STORAGE_VERSIONS = new Set([1, 2]);
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * Who chose the active festival. `'user'`: picked in the UI — kept while it stays published.
 * `'default'`: applied by the default-festival rule (or nothing chosen yet) — re-evaluated by every
 * `ensureActiveFestival()`, so it follows the user's festivals as they load after sign-in.
 */
export type ActiveFestivalSource = 'user' | 'default';

export interface AppStoreState {
  /** The festival every tab shows; `null` until one is chosen or resolved (no hard-coded default). */
  activeFestivalId: string | null;
  /** Whether `activeFestivalId` was picked by the user or resolved by the default rule. */
  activeFestivalSource: ActiveFestivalSource;
  /**
   * The active festival's `accent_color`, always a valid `#RRGGBB` already passed through
   * `accessibleAccent` (dark text stays readable on it) — fill-only, never text.
   */
  activeFestivalAccent: string;
  /** The crew whose members/meetups/locations the map and group screens focus on. */
  selectedGroupId: string | null;
  /** The user picked a festival: sets it and its accent together (preferred). */
  setActiveFestival: (festival: Pick<Festival, 'id' | 'accent_color'>) => void;
  /** The user picked a festival by id; `null` clears the choice and lets the default rule apply. */
  setActiveFestivalId: (festivalId: string | null) => void;
  /** Invalid or empty values fall back to `DEFAULT_ACCENT`. */
  setActiveFestivalAccent: (accent: string | null | undefined) => void;
  setSelectedGroupId: (groupId: string | null) => void;
}

type PersistedState = Pick<
  AppStoreState,
  'activeFestivalId' | 'activeFestivalSource' | 'activeFestivalAccent' | 'selectedGroupId'
>;
type AppStore = StoreApi<AppStoreState>;

const INITIAL_STATE: PersistedState = {
  activeFestivalId: null,
  activeFestivalSource: 'default',
  activeFestivalAccent: DEFAULT_ACCENT,
  selectedGroupId: null,
};

function normaliseAccent(accent: string | null | undefined): string {
  return accessibleAccent(accent && HEX_COLOR.test(accent) ? accent : DEFAULT_ACCENT);
}

function normaliseSource(value: unknown): ActiveFestivalSource {
  return value === 'user' ? 'user' : 'default';
}

function normaliseId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

let storage: MMKV | null = null;

/** Lazily created so importing this module never touches native storage. */
function getStorage(): MMKV | null {
  if (!storage) {
    try {
      storage = createMMKV({ id: STORAGE_ID });
    } catch {
      return null;
    }
  }
  return storage;
}

function readPersisted(): PersistedState {
  try {
    const raw = getStorage()?.getString(STORAGE_KEY);
    if (!raw) {
      return { ...INITIAL_STATE };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState> & { v?: number };
    if (typeof parsed.v !== 'number' || !READABLE_STORAGE_VERSIONS.has(parsed.v)) {
      return { ...INITIAL_STATE };
    }
    const activeFestivalId = normaliseId(parsed.activeFestivalId);
    return {
      activeFestivalId,
      activeFestivalSource: activeFestivalId ? normaliseSource(parsed.activeFestivalSource) : 'default',
      activeFestivalAccent: normaliseAccent(parsed.activeFestivalAccent),
      selectedGroupId: normaliseId(parsed.selectedGroupId),
    };
  } catch {
    return { ...INITIAL_STATE };
  }
}

function writePersisted(state: PersistedState): void {
  try {
    getStorage()?.set(
      STORAGE_KEY,
      JSON.stringify({
        v: STORAGE_VERSION,
        activeFestivalId: state.activeFestivalId,
        activeFestivalSource: state.activeFestivalSource,
        activeFestivalAccent: state.activeFestivalAccent,
        selectedGroupId: state.selectedGroupId,
      }),
    );
  } catch {
    // Persistence is best effort; the in-memory state stays correct.
  }
}

function createAppStore(): AppStore {
  const store = createStore<AppStoreState>((set) => ({
    ...INITIAL_STATE,
    ...readPersisted(),
    setActiveFestival: (festival) => {
      const festivalId = normaliseId(festival.id);
      set({
        activeFestivalId: festivalId,
        activeFestivalSource: festivalId ? 'user' : 'default',
        activeFestivalAccent: normaliseAccent(festival.accent_color),
      });
    },
    setActiveFestivalId: (festivalId) => {
      const id = normaliseId(festivalId);
      set({ activeFestivalId: id, activeFestivalSource: id ? 'user' : 'default' });
    },
    setActiveFestivalAccent: (accent) => set({ activeFestivalAccent: normaliseAccent(accent) }),
    setSelectedGroupId: (groupId) => set({ selectedGroupId: normaliseId(groupId) }),
  }));

  store.subscribe((state, previous) => {
    if (
      state.activeFestivalId !== previous.activeFestivalId ||
      state.activeFestivalSource !== previous.activeFestivalSource ||
      state.activeFestivalAccent !== previous.activeFestivalAccent ||
      state.selectedGroupId !== previous.selectedGroupId
    ) {
      writePersisted(state);
    }
  });

  return store;
}

let appStore: AppStore | null = null;

/** The singleton store, for non-React callers (`getAppStore().getState()`). */
export function getAppStore(): AppStore {
  if (!appStore) {
    appStore = createAppStore();
  }
  return appStore;
}

/**
 * Clears the persisted and in-memory state (sign-out / account deletion). Subscribers re-render
 * with no active festival; `AppStoreProvider` then resolves the default again.
 */
export function resetAppStore(): void {
  try {
    getStorage()?.remove(STORAGE_KEY);
  } catch {
    // Ignore: the state reset below overwrites it on the next change anyway.
  }
  getAppStore().setState({ ...INITIAL_STATE });
}

/* ─── Default festival rule ─────────────────────────────── */

/**
 * Default festival from the local cache (never the network), by `pickDefaultFestival`. `null` when the
 * festival cache is empty.
 */
export async function resolveDefaultFestival(): Promise<Festival | null> {
  const [catalog, followed] = await Promise.all([getLocalFestivals(), getLocalUserFestivals()]);
  return pickDefaultFestival(
    catalog,
    followed.map((row) => row.festival_id),
    localTodayKey(),
  );
}

/** Applies the default rule's result without marking it as the user's choice. */
function applyDefaultFestival(store: AppStore, festival: Festival | null): void {
  store.setState(
    festival
      ? {
          activeFestivalId: festival.id,
          activeFestivalSource: 'default',
          activeFestivalAccent: normaliseAccent(festival.accent_color),
        }
      : { activeFestivalId: null, activeFestivalSource: 'default', activeFestivalAccent: DEFAULT_ACCENT },
  );
}

async function runEnsureActiveFestival(): Promise<string | null> {
  const store = getAppStore();
  const { activeFestivalId: startId, activeFestivalSource: startSource } = store.getState();
  // The user may pick a festival while the cache is read; never override that.
  const changedMeanwhile = () => {
    const state = store.getState();
    return state.activeFestivalId !== startId || state.activeFestivalSource !== startSource;
  };

  if (startId) {
    const current = await getLocalFestival(startId);
    if (current && current.status === 'published') {
      if (startSource === 'user') {
        if (!changedMeanwhile()) {
          store.getState().setActiveFestivalAccent(current.accent_color);
        }
        return store.getState().activeFestivalId;
      }
      // A defaulted festival follows the rule: re-resolve below (it is the fallback when it still wins).
    } else {
      // Unknown locally. Only replace the festival when the catalog is cached (we then know it is no
      // longer published); with an empty cache (first launch offline, cache rebuilt) keep it.
      const catalog = await getLocalFestivals();
      if (catalog.length === 0) {
        return store.getState().activeFestivalId;
      }
    }
  }

  const fallback = await resolveDefaultFestival();
  if (changedMeanwhile()) {
    return store.getState().activeFestivalId;
  }
  if (fallback || startId) {
    applyDefaultFestival(store, fallback);
  }
  return store.getState().activeFestivalId;
}

let ensureInFlight: Promise<string | null> | null = null;
let ensureQueued: Promise<string | null> | null = null;

/**
 * Makes sure `activeFestivalId` points at a cached, published festival:
 * - a festival the user picked is kept while it is published (its accent is refreshed);
 * - otherwise — nothing chosen, a defaulted festival, or a pick that is no longer published — the
 *   default rule (`resolveDefaultFestival()`) is applied, so a defaulted festival switches to the
 *   user's first followed festival once `user_festivals` is cached (after sign-in / fresh install).
 * Resolves the active id. Call after `refreshFestivalCatalog()`, `refreshUserFestivals()` and
 * follow/unfollow. A call made while a run is in progress queues one more run after it (so it sees
 * the cache as it is when called); further calls share that queued run. Never throws (cache errors
 * resolve the current id).
 */
export function ensureActiveFestival(): Promise<string | null> {
  if (!ensureInFlight) {
    ensureInFlight = runEnsureActiveFestival()
      .catch(() => getAppStore().getState().activeFestivalId)
      .finally(() => {
        ensureInFlight = null;
      });
    return ensureInFlight;
  }
  if (!ensureQueued) {
    ensureQueued = ensureInFlight.then(() => {
      ensureQueued = null;
      return ensureActiveFestival();
    });
  }
  return ensureQueued;
}

/* ─── React bindings ────────────────────────────────────── */

const AppStoreContext = createContext<AppStore | null>(null);

/**
 * Provides the store and applies the default-festival rule on mount and whenever the active
 * festival is cleared (e.g. by `resetAppStore()` on sign-out).
 */
export function AppStoreProvider({ children }: React.PropsWithChildren) {
  const store = getAppStore();

  useEffect(() => {
    void ensureActiveFestival();
    return store.subscribe((state, previous) => {
      if (state.activeFestivalId === null && previous.activeFestivalId !== null) {
        void ensureActiveFestival();
      }
    });
  }, [store]);

  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new Error('useAppStore must be used within AppStoreProvider.');
  }

  return useStore(store, selector);
}
