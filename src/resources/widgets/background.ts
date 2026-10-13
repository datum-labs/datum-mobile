import { requireOptionalNativeModule } from 'expo';

import { session } from '@/auth/instance';

import { currentSnapshot, refreshWidgets, widgetsEnabled } from './service';

/**
 * Background refresh of the widget snapshot (expo-background-task, a
 * BGProcessingTask iOS runs at its discretion, at most every
 * MINIMUM_INTERVAL_MIN). It runs the app's own JS, so the app stays the only
 * refresher of the OIDC session; the widget extension never refreshes tokens.
 */
export const WIDGET_REFRESH_TASK = 'datum.widgets.refresh';
const MINIMUM_INTERVAL_MIN = 30;

type BackgroundTaskModule = typeof import('expo-background-task');
type TaskManagerModule = typeof import('expo-task-manager');

// Both are native modules: a binary built before they were added doesn't have
// them, and importing the packages there throws. Require them only when present.
function nativeModules(): { task: BackgroundTaskModule; manager: TaskManagerModule } | undefined {
  if (!requireOptionalNativeModule('ExpoBackgroundTask') || !requireOptionalNativeModule('ExpoTaskManager')) {
    return undefined;
  }
  try {
    return {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      task: require('expo-background-task') as BackgroundTaskModule,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      manager: require('expo-task-manager') as TaskManagerModule,
    };
  } catch {
    return undefined;
  }
}

/** Refresh the projects the widgets show, as the signed-in user. */
export async function runWidgetRefresh(): Promise<boolean> {
  if (!widgetsEnabled()) return false;
  const state = session.getState().status === 'loading' ? await session.restore() : session.getState();
  if (state.status !== 'signedIn' || state.devToken) return false;
  const snapshot = await currentSnapshot();
  const selectedId = snapshot?.currentProjectId;
  const selected = selectedId
    ? (snapshot?.projects[selectedId] ?? snapshot?.directory.find((ref) => ref.projectId === selectedId))
    : undefined;
  await refreshWidgets({ sub: state.user.sub, selected });
  return true;
}

// TaskManager needs the task defined at startup, before iOS runs it.
const modules = nativeModules();
if (modules && !modules.manager.isTaskDefined(WIDGET_REFRESH_TASK)) {
  modules.manager.defineTask(WIDGET_REFRESH_TASK, async () => {
    try {
      await runWidgetRefresh();
      return modules.task.BackgroundTaskResult.Success;
    } catch {
      return modules.task.BackgroundTaskResult.Failed;
    }
  });
}

/** Ask iOS to run the refresh periodically (idempotent). No-op without the modules or widgets. */
export async function scheduleWidgetRefresh(): Promise<void> {
  if (!modules || !widgetsEnabled()) return;
  try {
    if (await modules.manager.isTaskRegisteredAsync(WIDGET_REFRESH_TASK)) return;
    await modules.task.registerTaskAsync(WIDGET_REFRESH_TASK, { minimumInterval: MINIMUM_INTERVAL_MIN });
  } catch {
    // Restricted (Low Power Mode, Background App Refresh off): foreground refreshes still run.
  }
}

/** Signed out: stop refreshing. */
export async function cancelWidgetRefresh(): Promise<void> {
  if (!modules) return;
  try {
    if (await modules.manager.isTaskRegisteredAsync(WIDGET_REFRESH_TASK)) {
      await modules.task.unregisterTaskAsync(WIDGET_REFRESH_TASK);
    }
  } catch {
    // Nothing registered.
  }
}
