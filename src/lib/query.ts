import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  defaultShouldDehydrateQuery,
  focusManager,
  QueryCache,
  QueryClient,
  type Query,
} from '@tanstack/react-query';
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
  throttleTime: 1_000,
});

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
 * Poll interval for a screen's queries: LIVE_REFETCH_MS while the screen is
 * focused, off otherwise. App-background pausing comes from focusManager.
 */
export function useLiveRefetchInterval(ms: number = LIVE_REFETCH_MS): number | false {
  const focused = useIsFocused();
  return focused ? ms : false;
}

/** Forget every cached response, in memory and on disk (sign-out, user switch). */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await queryPersister.removeClient();
}
