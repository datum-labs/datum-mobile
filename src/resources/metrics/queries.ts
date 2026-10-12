import { keepPreviousData, useQuery, type Query } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { ApiError } from '@/api/errors';
import {
  albErrorRateQuery,
  albLatencyPercentilesQuery,
  albLatencyQuantileQuery,
  albRegionalRpsQuery,
  albRequestCountQuery,
  albRpsByClassQuery,
  albRpsQuery,
  albWafByOutcomeQuery,
  autoStepForRange,
  computeChartStep,
  firstSeriesPoints,
  formatDurationFromMs,
  lastValue,
  metricRangePreset,
  REGION_LABEL,
  resolveMetricWindow,
  scalarValue,
  valuesByLabel,
  type MetricPoint,
  type MetricRangeKey,
  type PromResponse,
} from '@/lib/metrics';
import { useLiveRefetchInterval } from '@/lib/query';

import { isMetricsUnavailable, metricsSource } from './source';

/** Metric responses are only useful fresh: dropped from memory quickly, never persisted. */
const METRICS_GC_MS = 10 * 60_000;
const NOT_PERSISTED = { persist: false } as const;

export const metricKeys = {
  all: ['metrics'] as const,
  query: (kind: 'range' | 'instant', promql: string, range: MetricRangeKey, step: string) =>
    [...metricKeys.all, kind, promql, range, step] as const,
};

/** Auth, a bad query (422) and a missing backend won't fix themselves on retry. */
export function retryMetrics(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [400, 401, 403, 404, 422].includes(error.status)) return false;
  return failureCount < 2;
}

interface MetricQueryOptions {
  kind: 'range' | 'instant';
  promql: string | undefined;
  range: MetricRangeKey;
  step: string;
  enabled: boolean;
  /** Poll interval while focused (false when off). */
  interval: number | false;
}

/**
 * One PromQL query. The window is re-anchored to "now" on every fetch, so a
 * pull-to-refresh or a poll slides it forward. Polling stops once the
 * gateway says metrics aren't available.
 */
function useMetricQuery({ kind, promql, range, step, enabled, interval }: MetricQueryOptions) {
  const refetchInterval = useCallback(
    (query: Query<PromResponse, Error>) => (isMetricsUnavailable(query.state.error) ? false : interval),
    [interval]
  );
  return useQuery<PromResponse, Error>({
    queryKey: metricKeys.query(kind, promql ?? '', range, step),
    queryFn: ({ signal }) =>
      kind === 'range'
        ? metricsSource.queryRange(promql as string, { ...resolveMetricWindow(range), step }, signal)
        : metricsSource.query(promql as string, { signal }),
    enabled: enabled && metricsSource.available && !!promql,
    refetchInterval,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    gcTime: METRICS_GC_MS,
    retry: retryMetrics,
    meta: NOT_PERSISTED,
  });
}

type MetricQuery = ReturnType<typeof useMetricQuery>;

export interface MetricsStatus {
  /** Nothing to show yet: the first fetch of every query is in flight. */
  loading: boolean;
  /** No backend, or the gateway refused this user. */
  unavailable: boolean;
  /** The first real failure (network, 5xx, bad query), when there's no data to show. */
  error: Error | null;
  /** Newest successful fetch, ms. */
  updatedAt: number;
  refetch: () => Promise<unknown>;
}

function statusOf(queries: MetricQuery[]): MetricsStatus {
  const unavailable = !metricsSource.available || queries.some((q) => isMetricsUnavailable(q.error));
  const anyData = queries.some((q) => q.data !== undefined);
  return {
    loading: !unavailable && !anyData && queries.some((q) => q.isPending && q.fetchStatus !== 'idle'),
    unavailable,
    error: unavailable || anyData ? null : (queries.find((q) => q.error)?.error ?? null),
    updatedAt: Math.max(0, ...queries.map((q) => q.dataUpdatedAt)),
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}

/** Unix-second start of the window the newest data was fetched for (charts pin it to their left edge). */
export function windowStartOf(updatedAt: number, durationMs: number): number {
  return Math.floor((updatedAt - durationMs) / 1000);
}

// ── Load balancer ────────────────────────────────────────────────────────

export const STATUS_CLASSES = ['2XX', '3XX', '4XX', '5XX'] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

export const WAF_OUTCOMES = ['allowed', 'blocked', 'dropped'] as const;
export type WafOutcome = (typeof WAF_OUTCOMES)[number];

export interface AlbMetrics {
  rps: { points: MetricPoint[]; current: number | null };
  errorRate: { points: MetricPoint[]; current: number | null };
  p95: { points: MetricPoint[] };
  /** Over the whole window, as the portal's KPI computes them. */
  percentiles: { p50: number | null; p95: number | null; p99: number | null };
  /** Requests over the window. */
  total: number | null;
  /** Requests per status class over the window (average rate × window). */
  byClass: Record<StatusClass, number> | null;
  /** WAF events per outcome over the window; null when there were none. */
  waf: Record<WafOutcome, number> | null;
  /** Average requests per second per region over the window, busiest first. */
  regions: { region: string; rps: number }[];
}

/**
 * Error rate is `errors / total`, so it has no samples when there were no
 * 4xx/5xx series at all. With traffic, that reads as 0%, not "no data".
 */
export function errorRateView(errorRate: MetricPoint[], rps: MetricPoint[]): AlbMetrics['errorRate'] {
  if (errorRate.length > 0) return { points: errorRate, current: lastValue(errorRate) };
  const hadTraffic = rps.some((p) => p.v > 0);
  return {
    points: hadTraffic ? rps.map((p) => ({ t: p.t, v: 0 })) : [],
    current: (lastValue(rps) ?? 0) > 0 ? 0 : null,
  };
}

export function byClassView(response: PromResponse | undefined, windowSeconds: number): AlbMetrics['byClass'] {
  if (!response) return null;
  const rates = valuesByLabel(response, 'envoy_response_code_class');
  return Object.fromEntries(STATUS_CLASSES.map((c) => [c, (rates[c] ?? 0) * windowSeconds])) as Record<StatusClass, number>;
}

export function wafView(response: PromResponse | undefined): AlbMetrics['waf'] {
  const counts = valuesByLabel(response, 'coraza_outcome');
  const view = Object.fromEntries(WAF_OUTCOMES.map((o) => [o, counts[o] ?? 0])) as Record<WafOutcome, number>;
  return WAF_OUTCOMES.some((o) => Math.round(view[o]) > 0) ? view : null;
}

export function regionsView(response: PromResponse | undefined): AlbMetrics['regions'] {
  return Object.entries(valuesByLabel(response, REGION_LABEL))
    .filter(([region]) => region !== '')
    .map(([region, rps]) => ({ region, rps }))
    .sort((a, b) => b.rps - a.rps || a.region.localeCompare(b.region));
}

export function percentilesView(response: PromResponse | undefined): AlbMetrics['percentiles'] {
  const values = valuesByLabel(response, 'quantile');
  return { p50: values.p50 ?? null, p95: values.p95 ?? null, p99: values.p99 ?? null };
}

/**
 * Everything the ALB metrics screen shows, with the portal's choices: rate
 * window = step = `autoStepForRange(range)`, and window totals over the whole
 * range. Polls every 30 s while the screen is focused and the app active.
 */
export function useAlbMetrics(projectId: string | undefined, proxyId: string | undefined, range: MetricRangeKey) {
  const interval = useLiveRefetchInterval();
  const durationMs = metricRangePreset(range).durationMs;
  const step = autoStepForRange(durationMs);
  const window = formatDurationFromMs(durationMs);
  const enabled = !!projectId && !!proxyId;
  const scope = { projectId: projectId ?? '', proxyId: proxyId ?? '' };
  const common = { range, enabled, interval } as const;

  const rps = useMetricQuery({ ...common, kind: 'range', step, promql: albRpsQuery(scope, step) });
  const errorRate = useMetricQuery({ ...common, kind: 'range', step, promql: albErrorRateQuery(scope, step) });
  const p95 = useMetricQuery({ ...common, kind: 'range', step, promql: albLatencyQuantileQuery(0.95, scope, step) });
  const percentiles = useMetricQuery({ ...common, kind: 'instant', step: window, promql: albLatencyPercentilesQuery(scope, window) });
  const total = useMetricQuery({ ...common, kind: 'instant', step: window, promql: albRequestCountQuery(scope, window) });
  const byClass = useMetricQuery({ ...common, kind: 'instant', step: window, promql: albRpsByClassQuery(scope, window) });
  const waf = useMetricQuery({ ...common, kind: 'instant', step: window, promql: albWafByOutcomeQuery(scope, window) });
  const regions = useMetricQuery({ ...common, kind: 'instant', step: window, promql: albRegionalRpsQuery(scope, window) });

  const all = [rps, errorRate, p95, percentiles, total, byClass, waf, regions];
  const status = statusOf(all);

  const data = useMemo((): AlbMetrics => {
    const rpsPoints = firstSeriesPoints(rps.data);
    return {
      rps: { points: rpsPoints, current: lastValue(rpsPoints) },
      errorRate: errorRateView(firstSeriesPoints(errorRate.data), rpsPoints),
      p95: { points: firstSeriesPoints(p95.data) },
      percentiles: percentilesView(percentiles.data),
      total: scalarValue(total.data),
      byClass: byClassView(byClass.data, durationMs / 1000),
      waf: wafView(waf.data),
      regions: regionsView(regions.data),
    };
  }, [rps.data, errorRate.data, p95.data, percentiles.data, total.data, byClass.data, waf.data, regions.data, durationMs]);

  return { data, step, windowStart: windowStartOf(status.updatedAt, durationMs), ...status };
}

// ── Compute ──────────────────────────────────────────────────────────────

export interface ComputeMetrics {
  cpu: { points: MetricPoint[]; current: number | null };
  memory: { points: MetricPoint[]; current: number | null };
}

/**
 * CPU (cores) and memory (bytes) over the window for one instance or a
 * workload's instances. The caller passes the compute UI's PromQL.
 */
export function useComputeMetrics(
  queries: { cpu: string | undefined; memory: string | undefined } | undefined,
  range: MetricRangeKey
) {
  const interval = useLiveRefetchInterval();
  const durationMs = metricRangePreset(range).durationMs;
  const step = computeChartStep(durationMs);
  const common = { range, step, interval, kind: 'range', enabled: !!queries } as const;
  const cpu = useMetricQuery({ ...common, promql: queries?.cpu });
  const memory = useMetricQuery({ ...common, promql: queries?.memory });
  const status = statusOf([cpu, memory]);
  const data = useMemo((): ComputeMetrics => {
    const cpuPoints = firstSeriesPoints(cpu.data);
    const memoryPoints = firstSeriesPoints(memory.data);
    return {
      cpu: { points: cpuPoints, current: lastValue(cpuPoints) },
      memory: { points: memoryPoints, current: lastValue(memoryPoints) },
    };
  }, [cpu.data, memory.data]);
  return { data, step, windowStart: windowStartOf(status.updatedAt, durationMs), ...status };
}
