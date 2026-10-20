import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  defaultShouldDehydrateQuery,
  focusManager,
  QueryCache,
  QueryClient,
  type Query,
} from '@tanstack/react-query';
import { persistQueryClientSave, type Persister } from '@tanstack/react-query-persist-client';
import { useIsFocused } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';

import { ApiError, EmailNotVerifiedError } from '@/api/errors';
import { authEvents } from '@/auth/events';
import { AuthRequiredError } from '@/auth/session';
import { env } from '@/config/env';

/** How often a focused screen re-polls while the app is in the foreground. */
export const LIVE_REFETCH_MS = 30_000;

/** Persisted cache lifetime: enough to paint the last-seen data on a cold start. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60_000;

function isFatal(error: unknown): boolean {
  if (error instanceof AuthRequiredError || error instanceof EmailNotVerifiedError) return true;
  if (error instanceof ApiError) return error.status === 401 || error.status === 403 || error.status === 404;
  return false;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof AuthRequiredError) {
        authEvents.emit({ type: 'authRequired', message: error.message });
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: PERSIST_MAX_AGE_MS,
      retry: (failureCount, error) => !isFatal(error) && failureCount < 2,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: `datum.query-cache.${env.variant}.v1`,
  // Saves are already batched by subscribeQueryPersistence.
  throttleTime: 0,
});

/**
 * For PersistQueryClientProvider, which restores at launch (and holds
 * queries back until then) but would also dehydrate the whole cache on every
 * cache event, fetch-state changes included. Saving is done by
 * subscribeQueryPersistence instead, so this persister never writes.
 */
export const restoreOnlyPersister: Persister = {
  restoreClient: () => queryPersister.restoreClient(),
  persistClient: () => undefined,
  removeClient: () => queryPersister.removeClient(),
};

/** Provider dehydrate options that select nothing, so its per-event dehydrate is a cheap no-op. */
export const NO_DEHYDRATE = { shouldDehydrateQuery: () => false, shouldDehydrateMutation: () => false };

/** A persisted query that changed is written at most this long after. */
const PERSIST_DEBOUNCE_MS = 5_000;

let pendingSave: ReturnType<typeof setTimeout> | undefined;

function saveNow() {
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = undefined;
  void persistQueryClientSave({
    queryClient,
    persister: queryPersister,
    buster: PERSIST_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  }).catch(() => undefined);
}

/**
 * Write the cache to disk when a persisted query gets new data (or one is
 * dropped), batched, and flush when the app leaves the foreground. Start it
 * once the persisted cache has been restored, so an empty cache never
 * overwrites it.
 */
export function subscribeQueryPersistence(): () => void {
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    const changed =
      (event.type === 'updated' && event.action.type === 'success' && shouldPersistQuery(event.query)) ||
      (event.type === 'removed' && event.query.meta?.persist !== false);
    if (changed && !pendingSave) pendingSave = setTimeout(saveNow, PERSIST_DEBOUNCE_MS);
  });
  const appState = AppState.addEventListener('change', (next) => {
    if (next !== 'active' && pendingSave) saveNow();
  });
  return () => {
    unsubscribe();
    appState.remove();
    if (pendingSave) clearTimeout(pendingSave);
    pendingSave = undefined;
  };
}

/**
 * Which queries go to disk: the default (successful ones) minus any marked
 * `meta: { persist: false }`, such as pages of logs.
 */
export function shouldPersistQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && query.meta?.persist !== false;
}

/** Bumping this drops every persisted cache (e.g. after a model change). */
export const PERSIST_BUSTER = `${env.version}-1`;

/**
 * React Query's "window focus" on native is the app being active, so
 * refetchOnWindowFocus fires on foreground and refetchInterval pauses in the
 * background.
 */
export function wireAppStateFocus(): () => void {
  const onChange = (status: AppStateStatus) => focusManager.setFocused(status === 'active');
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}

/**
 * Options for a screen's queries: poll every `ms` while focused (paused in
 * the background by focusManager), and unsubscribe while
 * not, so screens left mounted under a push, behind a sheet or in another tab
 * neither re-render on cache updates nor refetch on app focus. Refocusing
 * resubscribes, which refetches anything stale.
 */
export function useLiveQuery(ms: number = LIVE_REFETCH_MS): { refetchInterval: number | false; subscribed: boolean } {
  const focused = useIsFocused();
  return { refetchInterval: focused ? ms : false, subscribed: focused };
}

/** Forget every cached response, in memory and on disk (sign-out, user switch). */
export async function clearQueryCache(): Promise<void> {
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = undefined;
  queryClient.clear();
  await queryPersister.removeClient();
}
