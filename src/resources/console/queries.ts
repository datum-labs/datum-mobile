import { useQuery } from '@tanstack/react-query';

import type { Instance } from '@/resources/compute/model';

import { canShowShell, resolveRuntimeClass } from './control-plane';
import { consoleService } from './service';

/** Permission answers are cached for five minutes, as the portal does. */
const ACCESS_STALE_MS = 5 * 60_000;

export const consoleKeys = {
  all: ['console'] as const,
  access: (projectId: string) => [...consoleKeys.all, 'access', projectId] as const,
};

/** Session-create permission, the project's session allowance and the runtime classes. */
export function useShellAccess(projectId: string | undefined) {
  return useQuery({
    queryKey: consoleKeys.access(projectId ?? ''),
    queryFn: () => consoleService.access(projectId as string),
    enabled: !!projectId,
    staleTime: ACCESS_STALE_MS,
    retry: false,
    // Permissions change server-side; don't paint a stale answer on launch.
    meta: { persist: false },
  });
}

/**
 * Whether to offer "Open shell" for an instance (compute `useShellAvailable`):
 * the user may create sessions, the project's allowance isn't zero, the
 * instance's runtime class advertises `exec`, it has a container, and it's
 * running. Undefined while that's still being worked out.
 */
export function useShellAvailable(projectId: string | undefined, instance: Instance | undefined): boolean | undefined {
  const access = useShellAccess(projectId);
  if (!projectId) return false;
  if (access.isPending || !instance) return undefined;
  if (!access.data) return false;
  return (
    instance.status === 'Available' &&
    canShowShell({
      canCreateSessions: access.data.canCreateSessions,
      sessionAllowance: access.data.sessionAllowance,
      runtimeClass: resolveRuntimeClass(instance.runtimeClass, access.data.runtimeClasses),
      containers: instance.containers,
    })
  );
}
