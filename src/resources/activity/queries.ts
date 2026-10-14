import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useCallback } from 'react';

import { ApiError } from '@/api/errors';

import {
  activityService,
  toActivityPage,
  type ActivityItem,
  type ActivityPage,
  type ResourceActivityTarget,
} from './service';

export const activityKeys = {
  all: ['activity'] as const,
  resource: (projectId: string, kind: string, name: string) =>
    [...activityKeys.all, 'resource', projectId, kind, name] as const,
};

/** Continue cursors go stale, so pages stay in memory only. */
const NOT_PERSISTED = { persist: false } as const;

/** Bad query, auth, permission and not-provisioned errors won't fix themselves on retry. */
export function retryActivity(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) return false;
  return failureCount < 2;
}

/**
 * The portal's special cases (cloud-portal `features/activity/error-formatter`):
 * 403 is no permission, 404 is an activity API not provisioned for this scope.
 */
export function activityUnavailableReason(error: unknown): 'forbidden' | 'unavailable' | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'unavailable';
  return undefined;
}

/** Every loaded page in order, without repeats across page boundaries. */
export function flattenActivityPages(data: InfiniteData<ActivityPage, string | undefined>): ActivityItem[] {
  const seen = new Set<string>();
  const items: ActivityItem[] = [];
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

/**
 * The last 7 days of activity for one resource, newest first, 30 at a time
 * like the portal's embedded feed. `fetchNextPage` follows `status.continue`.
 */
export function useResourceActivity(projectId: string | undefined, target: Partial<ResourceActivityTarget>) {
  const { kind, name } = target;
  const select = useCallback(
    (data: InfiniteData<ActivityPage, string | undefined>) => flattenActivityPages(data),
    []
  );
  return useInfiniteQuery({
    queryKey: activityKeys.resource(projectId ?? '', kind ?? '', name ?? ''),
    queryFn: async ({ pageParam, signal }) =>
      toActivityPage(
        await activityService.queryResource(
          projectId as string,
          { kind: kind as string, name: name as string },
          { cursor: pageParam, signal }
        )
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.continue,
    select,
    enabled: !!projectId && !!kind && !!name,
    staleTime: 30_000,
    retry: retryActivity,
    meta: NOT_PERSISTED,
  });
}
