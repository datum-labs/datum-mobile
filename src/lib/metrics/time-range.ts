// Relative windows for metric screens. Each fetch re-anchors the window to "now", so query
// keys hold the preset rather than absolute bounds (as the log screens do).
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const METRIC_RANGE_PRESETS = [
  { key: '15m', label: 'Last 15 minutes', durationMs: 15 * MINUTE_MS },
  { key: '1h', label: 'Last hour', durationMs: HOUR_MS },
  { key: '6h', label: 'Last 6 hours', durationMs: 6 * HOUR_MS },
  { key: '24h', label: 'Last 24 hours', durationMs: DAY_MS },
  { key: '7d', label: 'Last 7 days', durationMs: 7 * DAY_MS },
] as const;

export type MetricRangeKey = (typeof METRIC_RANGE_PRESETS)[number]['key'];

export const DEFAULT_METRIC_RANGE: MetricRangeKey = '1h';

/** The load balancer screen offers every preset; compute screens offer the compute UI's three. */
export const ALB_METRIC_RANGES: readonly MetricRangeKey[] = ['15m', '1h', '6h', '24h', '7d'];
export const COMPUTE_METRIC_RANGES: readonly MetricRangeKey[] = ['1h', '6h', '24h'];

export function isMetricRangeKey(value: unknown): value is MetricRangeKey {
  return METRIC_RANGE_PRESETS.some((preset) => preset.key === value);
}

export function metricRangePreset(key: MetricRangeKey) {
  return METRIC_RANGE_PRESETS.find((preset) => preset.key === key) ?? METRIC_RANGE_PRESETS[1];
}

/** Unix-second bounds for a preset ending at `now`. */
export function resolveMetricWindow(key: MetricRangeKey, now: number = Date.now()): { start: number; end: number } {
  const end = Math.floor(now / 1000);
  return { start: end - Math.floor(metricRangePreset(key).durationMs / 1000), end };
}

// ── Ported from cloud-portal app/modules/metrics/utils (a7010d0e) ───────────

/** "90s" → "1m": the portal's `formatDurationFromMs` (floors to one unit). */
export function formatDurationFromMs(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "5m" → 300000; null for anything that isn't `<n><s|m|h|d|w>`. */
export function parseDurationToMs(duration: string): number | null {
  const match = duration.match(/^(\d+)([smhdw])$/);
  if (!match) return null;
  const value = parseInt(match[1] as string, 10);
  const unit = { s: 1_000, m: MINUTE_MS, h: HOUR_MS, d: DAY_MS, w: 7 * DAY_MS }[match[2] as 's' | 'm' | 'h' | 'd' | 'w'];
  return value * unit;
}

const AUTO_STEPS: { label: string; ms: number }[] = [
  { label: '15s', ms: 15_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '10m', ms: 600_000 },
  { label: '15m', ms: 900_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
];

const AUTO_MIN_POINTS = 16;

/**
 * The portal's `autoStepForRange`: the coarsest step that still yields at
 * least 16 points. It is also the rate window for the ALB charts.
 */
export function autoStepForRange(rangeMs: number): string {
  if (!Number.isFinite(rangeMs) || rangeMs <= 0) return '1m';
  for (let i = AUTO_STEPS.length - 1; i >= 0; i--) {
    const step = AUTO_STEPS[i];
    if (rangeMs / step.ms >= AUTO_MIN_POINTS) return step.label;
  }
  return AUTO_STEPS[0].label;
}

/** The compute UI's `chartStepFor` (ui/consumer/src/lib/prometheus.ts at 285fb19d): ~400 points, never under 15 s. */
export function computeChartStep(rangeMs: number): string {
  const durationSec = Math.max(1, Math.floor(rangeMs / 1000));
  const step = Math.max(15, Math.floor(durationSec / 400));
  if (step < 60) return `${step}s`;
  if (step < 3600) return `${Math.floor(step / 60)}m`;
  return `${Math.floor(step / 3600)}h`;
}
