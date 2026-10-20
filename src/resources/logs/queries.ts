import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { ApiError } from '@/api/errors';
import {
  buildAlbLogQL,
  buildInstanceLogQL,
  countLokiValues,
  DEFAULT_LOG_RANGE,
  filterAccessLogs,
  filterConsoleLogs,
  LOG_LIVE_POLL_MS,
  LOG_PAGE_LIMIT,
  nextNs,
  resolveLogWindow,
  toAccessLogEntries,
  toConsoleLogEntries,
  type AccessLogEntry,
  type ConsoleLogEntry,
  type HttpStatusClass,
  type LogRangeKey,
  type LokiQueryRangeResponse,
  type LokiStream,
} from '@/lib/logs';
import { useLiveQuery } from '@/lib/query';

import { accessReviewService } from '../access-reviews/service';
import { LOGS_ACCESS_REVIEWS, logsService } from './service';

/** Log pages are large and only useful fresh: dropped from memory quickly, never persisted. */
const LOGS_GC_MS = 10 * 60_000;
const PERMISSION_STALE_MS = 5 * 60_000;
const NOT_PERSISTED = { persist: false } as const;

export const logKeys = {
  all: ['logs'] as const,
  permission: (projectId: string, check: keyof typeof LOGS_ACCESS_REVIEWS) =>
    [...logKeys.all, 'permission', projectId, check] as const,
  alb: (projectId: string, proxyId: string) => [...logKeys.all, 'alb', projectId, proxyId] as const,
  albRange: (projectId: string, proxyId: string, query: string, range: LogRangeKey, limit: number) =>
    [...logKeys.alb(projectId, proxyId), 'range', query, range, limit] as const,
  albEntry: (projectId: string, proxyId: string, timestampNs: string) =>
    [...logKeys.alb(projectId, proxyId), 'entry', timestampNs] as const,
  instances: (projectId: string, query: string, range: LogRangeKey, limit: number) =>
    [...logKeys.all, 'instances', projectId, query, range, limit] as const,
};

/** A bad query (400), auth, and permission errors won't fix themselves on retry. */
export function retryLogs(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) return false;
  return failureCount < 2;
}

export function isLogsForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

// ── Permission ───────────────────────────────────────────────────────────

export type LogsPermission = 'checking' | 'allowed' | 'denied' | 'unknown';

type ReviewState = { data?: { allowed: boolean }; isPending: boolean };

/** Denied if either review says no; allowed only when both say yes. */
export function logsPermissionStatus(proxy: ReviewState, query: ReviewState): LogsPermission {
  if (proxy.data?.allowed === false || query.data?.allowed === false) return 'denied';
  if (proxy.data?.allowed && query.data?.allowed) return 'allowed';
  if (proxy.isPending || query.isPending) return 'checking';
  return 'unknown';
}

/**
 * Both reviews the portal runs before a log query. A review that fails to
 * run (offline, 5xx) reads as `unknown`, and the query itself decides.
 */
export function useLogsPermission(projectId: string | undefined) {
  const review = (check: keyof typeof LOGS_ACCESS_REVIEWS) => ({
    queryKey: logKeys.permission(projectId ?? '', check),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      accessReviewService.review({ kind: 'project', project: projectId as string }, LOGS_ACCESS_REVIEWS[check], signal),
    enabled: !!projectId,
    staleTime: PERMISSION_STALE_MS,
  });
  const proxy = useQuery(review('proxy'));
  const query = useQuery(review('query'));
  const status = logsPermissionStatus(proxy, query);
  const refetch = useCallback(() => Promise.all([proxy.refetch(), query.refetch()]), [proxy, query]);
  return { status, refetch };
}

// ── Pages of logs ────────────────────────────────────────────────────────

export interface LogPage<T> {
  /** Rows after the client-side search. */
  entries: T[];
  /** Rows the server returned. */
  total: number;
  /** True when the server stopped at the page limit (older rows exist). */
  limited: boolean;
}

export interface LogQueryOptions {
  range?: LogRangeKey;
  search?: string;
  /** Re-poll every 5 s while the screen is focused and the app active. */
  live?: boolean;
  enabled?: boolean;
  limit?: number;
}

function useLogPolling(live: boolean | undefined) {
  const { refetchInterval, subscribed } = useLiveQuery(LOG_LIVE_POLL_MS);
  return { refetchInterval: live ? refetchInterval : false, subscribed };
}

/**
 * Access logs for one ALB, newest first. The window is re-anchored to "now"
 * on every fetch, so a pull-to-refresh or a live tick slides it forward.
 */
export function useAlbLogs(
  projectId: string | undefined,
  proxyId: string | undefined,
  options: LogQueryOptions & { statusClass?: HttpStatusClass } = {}
) {
  const { range = DEFAULT_LOG_RANGE, search, live, enabled = true, limit = LOG_PAGE_LIMIT, statusClass } = options;
  const { refetchInterval, subscribed } = useLogPolling(live);
  const query = proxyId ? buildAlbLogQL(proxyId, { statusClass }) : '';
  const select = useCallback(
    (response: LokiQueryRangeResponse): LogPage<AccessLogEntry> => {
      const all = toAccessLogEntries(response);
      return { entries: filterAccessLogs(all, search), total: all.length, limited: countLokiValues(response) >= limit };
    },
    [search, limit]
  );
  return useQuery({
    queryKey: logKeys.albRange(projectId ?? '', proxyId ?? '', query, range, limit),
    queryFn: ({ signal }) =>
      logsService.queryRange(projectId as string, { query, ...resolveLogWindow(range), limit }, signal),
    select,
    enabled: enabled && !!projectId && !!proxyId,
    refetchInterval,
    subscribed,
    staleTime: live ? 0 : 15_000,
    gcTime: LOGS_GC_MS,
    retry: retryLogs,
    meta: NOT_PERSISTED,
  });
}

/** The cached stream holding one access-log line, from any page already loaded for this ALB. */
export function findCachedAlbStream(
  pages: [unknown, LokiQueryRangeResponse | undefined][],
  timestampNs: string,
  requestId?: string
): LokiQueryRangeResponse | undefined {
  for (const [, page] of pages) {
    for (const stream of page?.data?.result ?? []) {
      const value = stream.values?.find(([ns]) => ns === timestampNs);
      if (!value) continue;
      if (requestId && stream.stream?.request_id !== requestId) continue;
      const only: LokiStream = { stream: stream.stream, values: [value] };
      return { status: 'success', data: { resultType: 'streams', result: [only] } };
    }
  }
  return undefined;
}

/**
 * One access-log entry, by its nanosecond timestamp (plus request id to
 * disambiguate). Served from an already-loaded page when possible, otherwise
 * fetched with a one-nanosecond window, so the route deep-links.
 */
export function useAlbLogEntry(
  projectId: string | undefined,
  proxyId: string | undefined,
  timestampNs: string | undefined,
  requestId?: string
) {
  const queryClient = useQueryClient();
  const select = useCallback(
    (response: LokiQueryRangeResponse): AccessLogEntry | null =>
      toAccessLogEntries(response).find(
        (entry) => entry.timestampNs === timestampNs && (!requestId || entry.requestId === requestId)
      ) ?? null,
    [timestampNs, requestId]
  );
  const query = proxyId ? buildAlbLogQL(proxyId, requestId ? { filters: { request_id: [requestId] } } : {}) : '';
  return useQuery({
    queryKey: logKeys.albEntry(projectId ?? '', proxyId ?? '', timestampNs ?? ''),
    queryFn: ({ signal }) =>
      logsService.queryRange(
        projectId as string,
        { query, start: timestampNs as string, end: nextNs(timestampNs as string), limit: 10 },
        signal
      ),
    initialData: () =>
      timestampNs && projectId && proxyId
        ? findCachedAlbStream(
            queryClient.getQueriesData<LokiQueryRangeResponse>({ queryKey: logKeys.alb(projectId, proxyId) }),
            timestampNs,
            requestId
          )
        : undefined,
    select,
    enabled: !!projectId && !!proxyId && !!timestampNs,
    // A logged request never changes.
    staleTime: Infinity,
    gcTime: LOGS_GC_MS,
    retry: retryLogs,
    meta: NOT_PERSISTED,
  });
}

/** Console output for one or more instances, merged newest first. */
export function useInstanceLogs(
  projectId: string | undefined,
  instanceNames: readonly string[] | undefined,
  options: LogQueryOptions = {}
) {
  const { range = DEFAULT_LOG_RANGE, search, live, enabled = true, limit = LOG_PAGE_LIMIT } = options;
  const { refetchInterval, subscribed } = useLogPolling(live);
  const query = buildInstanceLogQL(instanceNames ?? []);
  const select = useCallback(
    (response: LokiQueryRangeResponse): LogPage<ConsoleLogEntry> => {
      const all = toConsoleLogEntries(response);
      return { entries: filterConsoleLogs(all, search), total: all.length, limited: countLokiValues(response) >= limit };
    },
    [search, limit]
  );
  return useQuery({
    queryKey: logKeys.instances(projectId ?? '', query, range, limit),
    queryFn: ({ signal }) =>
      logsService.queryRange(projectId as string, { query, ...resolveLogWindow(range), limit }, signal),
    select,
    enabled: enabled && !!projectId && !!query,
    refetchInterval,
    subscribed,
    staleTime: live ? 0 : 15_000,
    gcTime: LOGS_GC_MS,
    retry: retryLogs,
    meta: NOT_PERSISTED,
  });
}
