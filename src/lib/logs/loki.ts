// Ported from datum-ui packages/datum-ui/src/components/features/logs/utils/flatten-loki.ts and
// types.ts at 1593e7c (timestamps kept as epoch ms + the raw ns string so cached entries stay
// JSON-safe; ns ordering compares digit strings instead of BigInt).
/**
 * Loki `/query_range` envelopes, as telemetry queryapi serves them, and the
 * flat newest-first entry list every log screen renders.
 */

export interface LokiStream {
  stream: Record<string, string>;
  values: [timestampNs: string, line: string][];
}

export interface LokiQueryRangeResponse {
  status: 'success' | 'error';
  data?: {
    resultType: 'streams' | 'vector' | 'matrix';
    result: LokiStream[];
  };
  errorType?: string;
  error?: string;
}

export interface LogEntry {
  /** Unique within one response. */
  id: string;
  /** Nanoseconds since the epoch, as served (too wide for a JS number). */
  timestampNs: string;
  /** Milliseconds since the epoch. */
  timeMs: number;
  line: string;
  labels: Record<string, string>;
}

const NS_DIGITS = /^\d{1,30}$/;

/** Epoch ns string → epoch ms (NaN when it isn't a decimal integer). */
export function nsToMs(timestampNs: string): number {
  if (!NS_DIGITS.test(timestampNs)) return Number.NaN;
  if (timestampNs.length <= 6) return 0;
  return Number(timestampNs.slice(0, -6));
}

/** Descending order of two ns strings without BigInt: longer is later, then lexical. */
export function compareNsDesc(a: string, b: string): number {
  const x = a.replace(/^0+/, '');
  const y = b.replace(/^0+/, '');
  if (x.length !== y.length) return y.length - x.length;
  return x < y ? 1 : x > y ? -1 : 0;
}

function flattenStream(stream: LokiStream, streamIndex: number): LogEntry[] {
  const labels = stream.stream ?? {};
  const entries: LogEntry[] = [];
  for (const [valueIndex, pair] of (stream.values ?? []).entries()) {
    const timestampNs = pair?.[0];
    const line = pair?.[1];
    if (!timestampNs || line === undefined) continue;
    const timeMs = nsToMs(timestampNs);
    if (Number.isNaN(timeMs)) continue;
    entries.push({
      id: `${timestampNs}-${streamIndex}-${valueIndex}`,
      timestampNs,
      timeMs,
      line,
      labels: { ...labels },
    });
  }
  return entries;
}

/** Every value of every stream, newest first. Error and non-stream envelopes are empty. */
export function flattenLokiStreams(response: LokiQueryRangeResponse | undefined): LogEntry[] {
  if (response?.status !== 'success' || response.data?.resultType !== 'streams' || !response.data.result)
    return [];
  const entries = response.data.result.flatMap(flattenStream);
  entries.sort((a, b) => compareNsDesc(a.timestampNs, b.timestampNs) || (a.id < b.id ? 1 : -1));
  return entries;
}

/** How many log lines the envelope carries, to tell whether `limit` cut it short. */
export function countLokiValues(response: LokiQueryRangeResponse | undefined): number {
  if (response?.status !== 'success' || response.data?.resultType !== 'streams') return 0;
  return (response.data.result ?? []).reduce((sum, stream) => sum + (stream.values?.length ?? 0), 0);
}

/** `ns + 1` on a digit string: the exclusive end of a window holding exactly one timestamp. */
export function nextNs(timestampNs: string): string {
  if (!NS_DIGITS.test(timestampNs)) return timestampNs;
  const digits = timestampNs.split('');
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] !== '9') {
      digits[i] = String(Number(digits[i]) + 1);
      return digits.join('');
    }
    digits[i] = '0';
  }
  return `1${digits.join('')}`;
}
