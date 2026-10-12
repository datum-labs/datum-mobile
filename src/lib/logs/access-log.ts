// Ported from cloud-portal app/resources/o11y-logs/o11y-log.adapter.ts and o11y-log.helpers.ts
// (`albHostValues`) at a7010d0e, and datum-ui packages/datum-ui/src/components/features/logs/
// utils/host.ts and utils/parse-log-line.ts (`parseAccessLogFields`, `splitPathQuery`) at
// 1593e7c. Adapted to a typed row instead of re-parsing labels at render time, and Envoy's `-`
// placeholder reads as unset.
/**
 * Envoy access logs for an ALB. The OTEL sink stores every field as a stream
 * label and leaves the line (Body) empty, so each request is usually its own
 * stream; the row is built from the labels.
 */
import { flattenLokiStreams, type LogEntry, type LokiQueryRangeResponse } from './loki';
import { httpStatusBadgeType, type LogBadgeType } from './severity';

/**
 * queryapi copies every resource and log attribute onto the stream. The app
 * keeps this subset; k8s and collector identity (pod, node, cluster) is left
 * on the wire.
 */
export const ALB_LOG_LABELS = [
  'method',
  'path',
  'response_code',
  'duration',
  'authority',
  'requested_server_name',
  'x_forwarded_host',
  'referer',
  'request_id',
  'protocol',
  'user_agent',
  'upstream_host',
  'response_flags',
] as const;

export type AlbLogLabel = (typeof ALB_LOG_LABELS)[number];

const ALB_LOG_LABEL_SET = new Set<string>(ALB_LOG_LABELS);

export interface AccessLogEntry {
  /** Stable across refetches: timestamp plus request id. */
  id: string;
  timestampNs: string;
  timeMs: number;
  method?: string;
  path?: string;
  /** HTTP status; 0 when Envoy sent no response (client went away, upstream reset). */
  status?: number;
  durationMs?: number;
  host?: string;
  requestId?: string;
  badge: LogBadgeType;
  /** Allowlisted labels, with Envoy's `-` placeholders removed. */
  fields: Partial<Record<AlbLogLabel, string>>;
  /** Text line, in the rare case a proxy writes one. */
  line: string;
}

/** Envoy writes `-` for an unset field. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '-' ? trimmed : undefined;
}

export function pickAlbLogLabels(labels: Record<string, string>): Partial<Record<AlbLogLabel, string>> {
  const picked: Partial<Record<AlbLogLabel, string>> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!ALB_LOG_LABEL_SET.has(key)) continue;
    const kept = present(value);
    if (kept) picked[key as AlbLogLabel] = kept;
  }
  return picked;
}

/**
 * Host shown for a request: the name the client asked for (SNI, then
 * X-Forwarded-Host) over the upstream `authority`, then `resource_name`.
 */
export function logRequestHost(labels: Record<string, string | undefined>): string | undefined {
  return (
    present(labels.host) ||
    present(labels.requested_server_name) ||
    present(labels.x_forwarded_host) ||
    present(labels.authority) ||
    present(labels.resource_name)
  );
}

/** Every distinct hostname on the row, for host search. */
export function albHostValues(labels: Record<string, string | undefined>): string[] {
  const seen = new Set<string>();
  for (const raw of [labels.host, labels.requested_server_name, labels.x_forwarded_host, labels.authority]) {
    const host = present(raw);
    if (host) seen.add(host);
  }
  return [...seen];
}

/** Envoy `%DURATION%` is whole milliseconds with no unit. */
export function parseDurationMs(raw: string | undefined): number | undefined {
  const value = present(raw);
  if (!value) return undefined;
  const n = Number.parseFloat(value.replace(/ms$/i, ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseStatus(raw: string | undefined): number | undefined {
  const value = present(raw);
  if (!value || !/^\d{1,3}$/.test(value)) return undefined;
  return Number(value);
}

export function toAccessLogEntry(entry: LogEntry): AccessLogEntry {
  const fields = pickAlbLogLabels(entry.labels);
  const status = parseStatus(fields.response_code);
  return {
    id: fields.request_id ? `${entry.timestampNs}-${fields.request_id}` : entry.id,
    timestampNs: entry.timestampNs,
    timeMs: entry.timeMs,
    method: fields.method?.toUpperCase(),
    path: fields.path,
    status,
    durationMs: parseDurationMs(fields.duration),
    host: logRequestHost(fields),
    requestId: fields.request_id,
    badge: httpStatusBadgeType(status === 0 ? undefined : status),
    fields,
    line: entry.line,
  };
}

/** Newest first; ids are de-duplicated so list keys stay unique. */
export function toAccessLogEntries(response: LokiQueryRangeResponse | undefined): AccessLogEntry[] {
  const seen = new Set<string>();
  const rows: AccessLogEntry[] = [];
  for (const entry of flattenLokiStreams(response)) {
    const row = toAccessLogEntry(entry);
    if (seen.has(row.id)) row.id = `${row.id}~${entry.id}`;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

export interface SplitPath {
  pathname: string;
  /** Decoded key/value pairs in order; repeated keys are kept. */
  params: [key: string, value: string][];
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** `/a/b?x=1&y=2#h` → pathname and decoded query params (no URLSearchParams on Hermes). */
export function splitPathQuery(path: string): SplitPath {
  const withoutHash = path.split('#')[0] ?? '';
  const q = withoutHash.indexOf('?');
  if (q === -1) return { pathname: withoutHash, params: [] };
  const params: [string, string][] = [];
  for (const part of withoutHash.slice(q + 1).split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decode(eq === -1 ? part : part.slice(0, eq));
    if (key) params.push([key, eq === -1 ? '' : decode(part.slice(eq + 1))]);
  }
  return { pathname: withoutHash.slice(0, q), params };
}

/** Labelled fields for the detail screen, in reading order; unset ones are skipped. */
export const ACCESS_LOG_FIELD_LABELS: Record<AlbLogLabel, string> = {
  method: 'Method',
  path: 'Path',
  response_code: 'Status',
  duration: 'Duration',
  requested_server_name: 'SNI',
  x_forwarded_host: 'X-Forwarded-Host',
  authority: 'Authority',
  protocol: 'Protocol',
  referer: 'Referer',
  user_agent: 'User agent',
  upstream_host: 'Upstream host',
  response_flags: 'Response flags',
  request_id: 'Request ID',
};

/**
 * Envoy `%RESPONSE_FLAGS%` short codes, worded from Envoy's access-log
 * reference. The ones that explain a 503 or a status of 0 matter most here.
 */
const RESPONSE_FLAGS: Record<string, string> = {
  DC: 'Downstream connection terminated',
  DI: 'Request delayed by fault injection',
  DPE: 'Downstream protocol error',
  DT: 'Request exceeded max duration',
  FI: 'Aborted by fault injection',
  IH: 'Invalid header value rejected',
  LH: 'Local health check failed',
  LR: 'Connection reset locally',
  NC: 'Upstream cluster not found',
  NFCF: 'No filter config found',
  NR: 'No route configured',
  OM: 'Overload manager terminated request',
  RFCF: 'Route config fetch failed',
  RL: 'Rate limited locally',
  RLSE: 'Rate limit service error',
  SI: 'Stream idle timeout',
  UAEX: 'Denied by external authorization',
  UC: 'Upstream connection terminated',
  UF: 'Upstream connection failure',
  UH: 'No healthy upstream',
  UMSDR: 'Upstream max stream duration reached',
  UO: 'Upstream overflow (circuit breaker)',
  UPE: 'Upstream protocol error',
  UR: 'Upstream reset the connection',
  URX: 'Upstream retry limit exceeded',
  UT: 'Upstream request timeout',
};

/** `UF,URX` → `UF · Upstream connection failure`, one per flag. */
export function describeResponseFlags(raw: string | undefined): string[] {
  const value = present(raw);
  if (!value) return [];
  return value
    .split(',')
    .map((flag) => flag.trim())
    .filter(Boolean)
    .map((flag) => (RESPONSE_FLAGS[flag] ? `${flag} · ${RESPONSE_FLAGS[flag]}` : flag));
}

const STATUS_TEXT: Record<number, string> = {
  0: 'No response',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  421: 'Misdirected Request',
  422: 'Unprocessable Content',
  426: 'Upgrade Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  499: 'Client Closed Request',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function httpStatusText(status: number | undefined): string | undefined {
  return status === undefined ? undefined : STATUS_TEXT[status];
}
