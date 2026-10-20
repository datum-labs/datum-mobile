import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '@/api/errors';

import { searchService } from './service';

/** The portal's SEARCH_DEBOUNCE_MS. */
export const SEARCH_DEBOUNCE_MS = 250;

export const searchKeys = {
  all: ['search'] as const,
  project: (projectId: string, query: string) => [...searchKeys.all, projectId, query] as const,
};

/** `value`, once it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Milo search hits for a query in this project. Not persisted; a 4xx (no
 * index, no permission) isn't retried, and the screen falls back to
 * matching the project's lists.
 */
export function useProjectSearch(projectId: string | undefined, query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: searchKeys.project(projectId ?? '', trimmed),
    queryFn: ({ signal }) => searchService.inProject(projectId as string, trimmed, signal),
    enabled: !!projectId && trimmed.length > 0,
    staleTime: 30_000,
    retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    meta: { persist: false },
  });
}
