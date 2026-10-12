/**
 * Where metric queries go. The one module to change when metrics move to a
 * proper API.
 *
 * TEMPORARY, STAGING ONLY. cloud-portal sends PromQL from the browser to its
 * own server (`POST /api/prometheus`, cookie session), which forwards it to
 * the in-cluster VictoriaMetrics. The app can't use that, so for now it
 * queries the same VictoriaMetrics through the staging telemetry gateway
 * (`<telemetryUrl>/metrics/api/v1/query[_range]`) with the user's bearer
 * token. The gateway only admits emails on an infra allowlist (others get
 * 401/403). It has NO per-tenant isolation: the only scoping is the
 * `resourcemanager_datumapis_com_project_name` label in the PromQL, exactly
 * as in the portal. Don't ship this path to production. When a tenant-safe
 * metrics API exists, re-point `query` / `queryRange` here and nothing else
 * changes.
 */
import { createApiClient, type TokenSource } from '@/api/client';
import { ApiError } from '@/api/errors';
import { session } from '@/auth/instance';
import { env } from '@/config/env';
import type { PromResponse } from '@/lib/metrics';

const BASE_URL = env.telemetryUrl ? `${env.telemetryUrl.replace(/\/$/, '')}/metrics/api/v1` : '';

function isDevTokenSession(): boolean {
  const state = session.getState();
  return state.status === 'signedIn' && state.devToken;
}

/**
 * The session's tokens, with refresh-and-retry on 401 as for the API. A
 * pasted dev token can't refresh, and the session signs out when one is
 * rejected; a 401 from this gateway (not allowlisted) must not do that, so it
 * surfaces as a plain 401 instead.
 */
const tokens: TokenSource = {
  getAccessToken: () => session.getAccessToken(),
  handleUnauthorized: (rejected) =>
    isDevTokenSession()
      ? Promise.reject(new ApiError(401, 'The metrics gateway rejected this token.', '/metrics'))
      : session.handleUnauthorized(rejected),
  refresh: () =>
    isDevTokenSession()
      ? Promise.reject(new ApiError(401, 'Development tokens cannot refresh.', '/metrics'))
      : session.refresh(),
};

const client = createApiClient({ baseUrl: BASE_URL, tokens });

async function get(path: string, query: Record<string, string | number>, signal?: AbortSignal): Promise<PromResponse> {
  if (!BASE_URL) throw new ApiError(404, 'Metrics are not available in this environment.', path);
  const body = await client.get<PromResponse>(path, { query, signal });
  // VictoriaMetrics answers a bad query with HTTP 422, but a 200 can still say "error".
  if (body?.status === 'error') throw new ApiError(422, body.error || 'Metric query failed', path);
  return body;
}

export interface RangeParams {
  /** Unix seconds. */
  start: number;
  end: number;
  /** Prometheus duration, e.g. "1m". */
  step: string;
}

export const metricsSource = {
  /** False where there's no metrics backend (production, for now). */
  available: BASE_URL !== '',

  /** Instant query at `time` (unix seconds; default now). */
  query(promql: string, options: { time?: number; signal?: AbortSignal } = {}): Promise<PromResponse> {
    return get('/query', { query: promql, ...(options.time !== undefined ? { time: options.time } : {}) }, options.signal);
  },

  /** Range query, one sample per `step`. */
  queryRange(promql: string, { start, end, step }: RangeParams, signal?: AbortSignal): Promise<PromResponse> {
    return get('/query_range', { query: promql, start, end, step }, signal);
  },
};

/**
 * Not allowlisted (401/403), or no backend here (404): the screen says
 * metrics aren't available, never shows an error.
 */
export function isMetricsUnavailable(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}
