/**
 * Prometheus HTTP API envelopes (as VictoriaMetrics returns them) and their
 * flattening into `{t, v}` series.
 *
 * Shapes seen from the staging gateway:
 * - values are strings (`"0"`, `"649.9999999999993"`), timestamps are unix
 *   seconds, already aligned to the step;
 * - a range query leaves out steps with no data rather than returning NaN, so
 *   a quiet histogram_quantile can come back as one point, or none;
 * - an empty result is `result: []`, not an error;
 * - bodies carry an extra `stats` object;
 * - a bad query is HTTP 422 `{status:"error", errorType:"422", error:"…"}`.
 *
 * The parser still drops `NaN` / `±Inf` samples, which upstream Prometheus
 * does return.
 */

export type PromSample = [number, string];

export interface PromSeriesResult {
  metric: Record<string, string>;
  /** Range queries. */
  values?: PromSample[];
  /** Instant queries. */
  value?: PromSample;
}

export type PromData =
  | { resultType: 'matrix' | 'vector'; result: PromSeriesResult[] }
  | { resultType: 'scalar' | 'string'; result: PromSample };

export interface PromResponse {
  status: 'success' | 'error';
  data?: PromData;
  errorType?: string;
  error?: string;
  warnings?: string[];
}

export interface MetricPoint {
  /** Unix seconds. */
  t: number;
  v: number;
}

export interface MetricSeries {
  labels: Record<string, string>;
  points: MetricPoint[];
}

function toPoint([t, raw]: PromSample): MetricPoint | null {
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) && Number.isFinite(t) ? { t, v } : null;
}

function points(samples: PromSample[] | undefined): MetricPoint[] {
  return (samples ?? []).map(toPoint).filter((p): p is MetricPoint => p !== null);
}

/**
 * Every series in a matrix, vector or scalar result, oldest point first.
 * Non-finite samples are dropped; a series left with no points is kept (its
 * labels still say it exists).
 */
export function toMetricSeries(response: PromResponse | undefined | null): MetricSeries[] {
  const data = response?.data;
  if (!data) return [];
  switch (data.resultType) {
    case 'matrix':
      return data.result.map((r) => ({ labels: r.metric ?? {}, points: points(r.values) }));
    case 'vector':
      return data.result.map((r) => ({ labels: r.metric ?? {}, points: points(r.value ? [r.value] : []) }));
    case 'scalar':
      return [{ labels: {}, points: points([data.result]) }];
    default:
      return [];
  }
}

/** The first series' points: the shape of every `sum(...)` the app charts. */
export function firstSeriesPoints(response: PromResponse | undefined | null): MetricPoint[] {
  return toMetricSeries(response)[0]?.points ?? [];
}

/** The newest finite value, or null. */
export function lastValue(points: readonly MetricPoint[]): number | null {
  return points.length > 0 ? points[points.length - 1].v : null;
}

/** An instant query's value per label value, e.g. by `coraza_outcome`. */
export function valuesByLabel(response: PromResponse | undefined | null, label: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const series of toMetricSeries(response)) {
    const value = lastValue(series.points);
    if (value === null) continue;
    const key = series.labels[label] ?? '';
    out[key] = (out[key] ?? 0) + value;
  }
  return out;
}

/** A single-value instant query (`sum(...)`), or null when the result is empty. */
export function scalarValue(response: PromResponse | undefined | null): number | null {
  return lastValue(firstSeriesPoints(response));
}
