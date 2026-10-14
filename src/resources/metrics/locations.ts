import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '@/api';
import { toLocation, type EdgeLocation, type RawLocation } from '@/lib/metrics';

const LOCATIONS = { group: 'locations.miloapis.com', version: 'v1alpha1', resource: 'locations' } as const;

/** Same shape as cloud-portal `locationKeys`. */
export const locationKeys = {
  all: ['locations'] as const,
  list: (projectId: string) => [...locationKeys.all, 'list', projectId] as const,
};

export const locationService = {
  /**
   * The cluster-scoped Location catalog as projected into the project (no
   * namespace). As in the portal, a 403 (no `locations.list`) or 404 (API
   * not offered) degrades to an empty catalog, and callers fall back to the
   * built-in region table.
   */
  async list(projectId: string, signal?: AbortSignal): Promise<EdgeLocation[]> {
    try {
      const items = await api.listResource<RawLocation>({ kind: 'project', project: projectId }, LOCATIONS, { signal });
      return items.map(toLocation);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return [];
      throw error;
    }
  },
};

/** The catalog changes rarely: fetched once and kept for a few minutes. */
export function useLocations(projectId: string | undefined) {
  return useQuery({
    queryKey: locationKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => locationService.list(projectId as string, signal),
    enabled: !!projectId,
    staleTime: 5 * 60_000,
  });
}
