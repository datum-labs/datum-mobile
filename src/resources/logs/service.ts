import { api, ApiError, projectScopedBase } from '@/api';
import type { LokiQueryRangeResponse } from '@/lib/logs';

import type { ResourceAttributes } from '../access-reviews/service';

/**
 * telemetry queryapi's Loki-shaped route, reached through the project's
 * control plane. Project tenancy is the URL; the query never names a project.
 */
export const O11Y_LOGS_QUERY_RANGE_PATH = '/apis/o11y.miloapis.com/v1alpha1/logs/loki/api/v1/query_range';

export const O11Y_LOGS_GROUP = 'o11y.miloapis.com';
export const O11Y_LOGS_RESOURCE = 'logs';

/**
 * A log query must pass two reviews (portal `useAlbLogsPermission`): Milo's
 * proxy hop to the Loki API, then queryapi's own `query` check.
 */
export const LOGS_ACCESS_REVIEWS = {
  proxy: {
    namespace: '',
    verb: 'get',
    group: O11Y_LOGS_GROUP,
    resource: O11Y_LOGS_RESOURCE,
    subresource: 'api',
    name: 'loki',
  },
  query: { namespace: '', verb: 'query', group: O11Y_LOGS_GROUP, resource: O11Y_LOGS_RESOURCE },
} as const satisfies Record<string, ResourceAttributes>;

export interface QueryRangeParams {
  /** LogQL with a single stream selector. */
  query: string;
  /** RFC 3339 or epoch nanoseconds. */
  start: string;
  end: string;
  limit: number;
  direction?: 'backward' | 'forward';
}

export const logsService = {
  /** Raw Loki envelope; an `{status: "error"}` body becomes an ApiError. */
  async queryRange(projectId: string, params: QueryRangeParams, signal?: AbortSignal) {
    const path = `${projectScopedBase(projectId)}${O11Y_LOGS_QUERY_RANGE_PATH}`;
    const body = await api.get<LokiQueryRangeResponse>(path, {
      signal,
      query: {
        query: params.query,
        start: params.start,
        end: params.end,
        limit: params.limit,
        direction: params.direction ?? 'backward',
      },
    });
    if (body?.status === 'error') throw new ApiError(400, body.error || 'Log query failed', path);
    return body;
  },
};
