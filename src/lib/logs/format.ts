// Adapted from datum-ui packages/datum-ui/src/components/features/logs/utils/format-timestamp.ts
// (`formatLogTimestampParts`, `formatLocalTimestamp`, `formatUtcTimestamp`) at 1593e7c, without
// date-fns.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Row time in local 24 h clock: `14:03:22.401`, prefixed with `Oct 11` when not today. */
export function formatLogTime(timeMs: number, now: number = Date.now()): string {
  const d = new Date(timeMs);
  if (Number.isNaN(d.getTime())) return '—';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  return sameDay(d, new Date(now)) ? time : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}

/** `2026-10-12 15:54:47.401 GMT-04:00` */
export function formatLocalTimestamp(timeMs: number): string {
  const d = new Date(timeMs);
  if (Number.isNaN(d.getTime())) return '—';
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)} ` +
    `GMT${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** `2026-10-12 19:54:47.401 UTC` */
export function formatUtcTimestamp(timeMs: number): string {
  const d = new Date(timeMs);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().replace('T', ' ').replace('Z', '')} UTC`;
}

/** `16 ms`, `1.24 s`, `2m 05s`. */
export function formatDurationMs(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}m ${pad(secs % 60)}s`;
}
