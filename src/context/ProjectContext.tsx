import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/auth/AuthProvider';

/** The org/project the app is looking at (the portal keeps this in cookies). */
export interface Selection {
  orgId: string;
  orgName?: string;
  projectId: string;
  projectName?: string;
}

interface ProjectContextValue {
  /** True once the persisted selection for this user has been read. */
  hydrated: boolean;
  selection: Selection | null;
  select: (selection: Selection) => void;
  clear: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const storageKey = (sub: string) => `datum.selection.v1.${sub}`;

function isSelection(value: unknown): value is Selection {
  const v = value as Partial<Selection> | null;
  return !!v && typeof v.orgId === 'string' && typeof v.projectId === 'string';
}

/** Persists the last org/project per signed-in user (AsyncStorage). */
export function ProjectContextProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const sub = state.status === 'signedIn' ? state.user.sub : undefined;
  const [loaded, setLoaded] = useState<{ sub?: string; selection: Selection | null }>({
    selection: null,
  });
  const authSettled = state.status !== 'loading';

  useEffect(() => {
    let cancelled = false;
    if (!sub) return;
    AsyncStorage.getItem(storageKey(sub))
      .then((raw) => {
        if (cancelled) return;
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        setLoaded({ sub, selection: isSelection(parsed) ? parsed : null });
      })
      .catch(() => !cancelled && setLoaded({ sub, selection: null }));
    return () => {
      cancelled = true;
    };
  }, [sub]);

  const select = useCallback(
    (next: Selection) => {
      if (!sub) return;
      setLoaded({ sub, selection: next });
      AsyncStorage.setItem(storageKey(sub), JSON.stringify(next)).catch(() => undefined);
    },
    [sub]
  );

  const clear = useCallback(() => {
    if (!sub) return;
    setLoaded({ sub, selection: null });
    AsyncStorage.removeItem(storageKey(sub)).catch(() => undefined);
  }, [sub]);

  const value = useMemo<ProjectContextValue>(() => {
    const current = sub && loaded.sub === sub ? loaded.selection : null;
    return {
      // Signed out: nothing to load. Signed in: wait for this user's entry.
      hydrated: authSettled && (!sub || loaded.sub === sub),
      selection: current,
      select,
      clear,
    };
  }, [authSettled, sub, loaded, select, clear]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useProjectContext must be used inside <ProjectContextProvider>');
  return value;
}

/** Current project id (undefined until one is chosen). */
export function useProjectId(): string | undefined {
  return useProjectContext().selection?.projectId;
}
