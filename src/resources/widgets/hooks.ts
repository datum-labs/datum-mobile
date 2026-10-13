import { router, useGlobalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { env } from '@/config/env';
import { useProjectContext, type Selection } from '@/context/ProjectContext';
import { projectHealth, type HealthInput, type ProjectRef } from '@/lib/health/snapshot';

import { DatumWidgets } from '../../../modules/datum-widgets';
import { scheduleWidgetRefresh } from './background';
import { currentSnapshot, publishHealth, refreshWidgets, widgetsEnabled } from './service';

/** Foreground refreshes at most this often (Home's own polling covers the rest). */
const FOREGROUND_REFRESH_MS = 60_000;
/** The project directory (every org's projects) is re-read this often. */
const DIRECTORY_REFRESH_MS = 6 * 60 * 60_000;

export function projectRef(selection: Selection): ProjectRef {
  return {
    projectId: selection.projectId,
    projectName: selection.projectName,
    orgId: selection.orgId,
    orgName: selection.orgName,
  };
}

/**
 * Keeps the widgets' snapshot current while signed in: the selected project
 * (the widgets' default), a refresh on every foreground, and the background
 * refresh task. Mounted once, in the signed-in tab layout.
 */
export function useWidgetSync() {
  const { selection } = useProjectContext();
  const { state } = useAuth();
  const sub = state.status === 'signedIn' ? state.user.sub : undefined;
  // A dev token can't be refreshed in the background, so only real sessions schedule it.
  const refreshable = state.status === 'signedIn' && !state.devToken;
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    if (!selection?.projectId || !sub) return;
    void publishHealth({ owner: sub, currentProjectId: selection.projectId });
  }, [selection?.projectId, sub]);

  useEffect(() => {
    if (!sub || !widgetsEnabled()) return;
    let lastRefresh = 0;
    let lastDirectory = 0;
    const run = () => {
      const now = Date.now();
      if (now - lastRefresh < FOREGROUND_REFRESH_MS) return;
      lastRefresh = now;
      const directory = now - lastDirectory >= DIRECTORY_REFRESH_MS;
      if (directory) lastDirectory = now;
      const current = selectionRef.current;
      void refreshWidgets({ selected: current ? projectRef(current) : undefined, sub, directory });
    };
    run();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') run();
    });
    return () => subscription.remove();
  }, [sub]);

  useEffect(() => {
    if (refreshable) void scheduleWidgetRefresh();
  }, [refreshable]);
}

/** Home publishes what it just loaded: the widgets match the screen. */
export function usePublishProjectHealth(
  selection: Selection | null,
  lists: Omit<HealthInput, 'project' | 'scheme' | 'now'>,
  loaded: boolean
) {
  const { state } = useAuth();
  const sub = state.status === 'signedIn' ? state.user.sub : undefined;
  const { proxies, workloads, instances, domains, zones } = lists;
  useEffect(() => {
    if (!selection || !loaded || !sub) return;
    void publishHealth({
      owner: sub,
      project: projectHealth({ project: projectRef(selection), scheme: env.scheme, proxies, workloads, instances, domains, zones }),
      currentProjectId: selection.projectId,
    });
  }, [selection, loaded, sub, proxies, workloads, instances, domains, zones]);
}

/**
 * Widget and control links:
 * - `?org=&project=` on any screen selects that project (a widget configured
 *   for another project links with its own). A project without an org is
 *   looked up in the widget snapshot's directory.
 * - Routes a Control Centre control left in the App Group (Ask Patch, the
 *   VPC control's "reconnect in the app") are opened when the app comes up.
 */
export function useWidgetLinks(ready: boolean) {
  const { selection, select, hydrated } = useProjectContext();
  const params = useGlobalSearchParams<{ org?: string; project?: string }>();
  const org = typeof params.org === 'string' ? params.org : undefined;
  const project = typeof params.project === 'string' ? params.project : undefined;
  const handled = useRef<string | undefined>(undefined);

  // Only when the link's params change: switching project afterwards must not snap back.
  useEffect(() => {
    if (!hydrated || !project) return;
    const key = `${org ?? ''}/${project}`;
    if (handled.current === key) return;
    handled.current = key;
    if (selection?.projectId === project && (!org || selection.orgId === org)) return;
    void (async () => {
      const snapshot = await currentSnapshot();
      const known =
        snapshot?.projects[project] ?? snapshot?.directory.find((ref) => ref.projectId === project);
      const orgId = org ?? known?.orgId;
      // Access is still enforced by the API; this only changes what we look at.
      if (orgId) select({ orgId, projectId: project, projectName: known?.projectName, orgName: known?.orgName });
    })();
  }, [hydrated, org, project, select, selection]);

  useEffect(() => {
    if (!ready || !widgetsEnabled()) return;
    const open = () => {
      const route = DatumWidgets.consumePendingRoute();
      if (route) router.navigate(route as Href);
    };
    open();
    const pending = DatumWidgets.onPendingRoute(open);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') open();
    });
    return () => {
      pending.remove();
      appState.remove();
    };
  }, [ready]);
}
