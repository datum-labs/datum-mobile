// Adapted from datum-ui packages/datum-ui/src/components/features/logs/utils/time-range.ts
// (`LOG_TIME_PRESETS`, `resolveLogTimeRange`) at 1593e7c: the phone offers five relative
// windows and always re-anchors them to "now" at fetch time, so the query key holds the preset
// rather than absolute bounds.
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const LOG_RANGE_PRESETS = [
  { key: '15m', label: 'Last 15 minutes', durationMs: 15 * MINUTE_MS },
  { key: '30m', label: 'Last 30 minutes', durationMs: 30 * MINUTE_MS },
  { key: '1h', label: 'Last hour', durationMs: HOUR_MS },
  { key: '6h', label: 'Last 6 hours', durationMs: 6 * HOUR_MS },
  { key: '24h', label: 'Last 24 hours', durationMs: 24 * HOUR_MS },
] as const;

export type LogRangeKey = (typeof LOG_RANGE_PRESETS)[number]['key'];

/** Portal default: last 30 minutes. */
export const DEFAULT_LOG_RANGE: LogRangeKey = '30m';

/** Page size for every log query (portal `ALB_LOGS_PAGE_LIMIT`). */
export const LOG_PAGE_LIMIT = 500;

/** Live mode re-polls at the portal's cadence; queryapi has no tail endpoint. */
export const LOG_LIVE_POLL_MS = 5_000;

export function isLogRangeKey(value: unknown): value is LogRangeKey {
  return LOG_RANGE_PRESETS.some((preset) => preset.key === value);
}

export function logRangePreset(key: LogRangeKey) {
  return LOG_RANGE_PRESETS.find((preset) => preset.key === key) ?? LOG_RANGE_PRESETS[1];
}

/** RFC 3339 bounds for a preset ending at `now`. */
export function resolveLogWindow(key: LogRangeKey, now: number = Date.now()): { start: string; end: string } {
  return {
    start: new Date(now - logRangePreset(key).durationMs).toISOString(),
    end: new Date(now).toISOString(),
  };
}
