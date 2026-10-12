// Ported from datum-ui packages/datum-ui/src/components/features/logs/utils/build-logql.ts at
// 1593e7c (the `|=` line filter is dropped: access logs keep an empty Body), cloud-portal
// app/resources/o11y-logs/o11y-log.helpers.ts at a7010d0e (ALB selector) and compute
// ui/consumer/src/lib/o11y-logs.ts at 285fb19d (instance selectors). The status-class matcher
// is the app's own.
/**
 * LogQL stream selectors for telemetry queryapi.
 *
 * - ALB access logs are pinned by Envoy `%ROUTE_NAME%`
 *   (`httproute/<namespace>/<httpProxyName>/rule/<i>/match/<j>/...`).
 * - Instance stdout is pinned by `datum_instance_name`. Log queries take ONE
 *   stream selector: `{a="x"} or {b="y"}` is a metric-query form and returns
 *   400, so several instances become one `=~"a|b"` matcher.
 * - Text search never goes into LogQL. Envoy's OTEL sink puts every field on
 *   attributes and leaves the Body empty, so `|=` would match nothing.
 */

export type LogFilters = Record<string, string[]>;

/** Loki/Prometheus label names. Anything else is dropped, not interpolated. */
const LOKI_LABEL_NAME = /^[a-z_]\w*$/i;
const LOKI_REGEX_META = /[.*+?^${}()|[\]\\]/g;

export function escapeLogQLQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapeLogQLRegexp(value: string): string {
  return value.replace(LOKI_REGEX_META, '\\$&');
}

function matcherClause(label: string, values: readonly string[]): string | null {
  if (!LOKI_LABEL_NAME.test(label)) return null;
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return `${label}="${escapeLogQLQuoted(unique[0] as string)}"`;
  return `${label}=~"${escapeLogQLQuoted(unique.map(escapeLogQLRegexp).join('|'))}"`;
}

/** `label="v"` / `label=~"a|b"` clauses for each filter, in insertion order. */
export function matcherClauses(matchers: LogFilters = {}): string[] {
  return Object.entries(matchers)
    .map(([label, values]) => matcherClause(label, values))
    .filter((clause): clause is string => clause !== null);
}

// ── ALB access logs ──────────────────────────────────────────────────────

export type HttpStatusClass = '2xx' | '3xx' | '4xx' | '5xx';
export const HTTP_STATUS_CLASSES: readonly HttpStatusClass[] = ['2xx', '3xx', '4xx', '5xx'];

export function albRouteNameRegexp(proxyId: string): string {
  return `httproute/[^/]+/${escapeLogQLRegexp(proxyId)}/.*`;
}

/** Server-side status class filter: queryapi accepts a label regexp on `response_code`. */
export function statusClassMatcher(statusClass: HttpStatusClass): string {
  return `response_code=~"${statusClass[0]}.."`;
}

/**
 * Identity labels the caller can't override, so a filter can never escape the
 * current load balancer (portal `albLogMatchers`). Host labels are matched
 * client-side, because the row's host is resolved from several of them.
 */
const ALB_LOCKED_LABELS = new Set([
  'resource_name',
  'route_name',
  'host',
  'authority',
  'requested_server_name',
  'x_forwarded_host',
  'response_code',
]);

export interface AlbLogQLOptions {
  /** Extra exact-match label filters (`method`, `request_id`, …). */
  filters?: LogFilters;
  statusClass?: HttpStatusClass;
}

/** `{route_name=~"httproute/[^/]+/<proxy>/.*", …}` for one HTTPProxy. */
export function buildAlbLogQL(proxyId: string, options: AlbLogQLOptions = {}): string {
  const extras = Object.fromEntries(
    Object.entries(options.filters ?? {}).filter(([label]) => !ALB_LOCKED_LABELS.has(label))
  );
  const clauses = [
    `route_name=~"${escapeLogQLQuoted(albRouteNameRegexp(proxyId))}"`,
    ...(options.statusClass ? [statusClassMatcher(options.statusClass)] : []),
    ...matcherClauses(extras),
  ];
  return `{${clauses.join(', ')}}`;
}

// ── Instance stdout ──────────────────────────────────────────────────────

/** Stream label that uniquely identifies an instance's stdout in queryapi. */
export const INSTANCE_LOG_LABEL = 'datum_instance_name';

/** One selector for one or many instances; '' when there are none. */
export function buildInstanceLogQL(instanceNames: readonly string[]): string {
  const unique = [...new Set(instanceNames.filter(Boolean))].sort();
  if (unique.length === 0) return '';
  if (unique.length === 1)
    return `{${INSTANCE_LOG_LABEL}="${escapeLogQLQuoted(unique[0] as string)}"}`;
  return `{${INSTANCE_LOG_LABEL}=~"${escapeLogQLQuoted(unique.map(escapeLogQLRegexp).join('|'))}"}`;
}
