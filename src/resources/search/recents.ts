import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import type { SearchItem } from './model';

/** The portal's RECENTS_CAPS. */
export const RECENTS_CAPS = { queries: 10, items: 5 } as const;

export interface SearchRecents {
  queries: string[];
  items: SearchItem[];
}

const EMPTY: SearchRecents = { queries: [], items: [] };

/** Per project, like the portal's `project:<id>` scope. */
export function recentsKey(projectId: string): string {
  return `datum.search.recents.v1.${projectId}`;
}

export function withQuery(recents: SearchRecents, query: string): SearchRecents {
  const trimmed = query.trim();
  if (!trimmed) return recents;
  return { ...recents, queries: [trimmed, ...recents.queries.filter((q) => q !== trimmed)].slice(0, RECENTS_CAPS.queries) };
}

export function withItem(recents: SearchRecents, item: SearchItem): SearchRecents {
  // Status is a snapshot; recents show the row without it.
  const stored: SearchItem = { ...item, status: undefined };
  return { ...recents, items: [stored, ...recents.items.filter((i) => i.key !== item.key)].slice(0, RECENTS_CAPS.items) };
}

/**
 * Recent searches and opened results for a project, in AsyncStorage.
 * Storage failures leave recents empty; search still works.
 */
export function useSearchRecents(projectId: string | undefined) {
  const [recents, setRecents] = useState<SearchRecents>(EMPTY);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void AsyncStorage.getItem(recentsKey(projectId))
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as Partial<SearchRecents>;
        setRecents({ queries: parsed.queries ?? [], items: parsed.items ?? [] });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const update = useCallback(
    (change: (current: SearchRecents) => SearchRecents) => {
      if (!projectId) return;
      setRecents((current) => {
        const next = change(current);
        void AsyncStorage.setItem(recentsKey(projectId), JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    },
    [projectId]
  );

  return {
    recents,
    addQuery: useCallback((query: string) => update((r) => withQuery(r, query)), [update]),
    addItem: useCallback((item: SearchItem) => update((r) => withItem(r, item)), [update]),
    clear: useCallback(() => update(() => EMPTY), [update]),
  };
}
