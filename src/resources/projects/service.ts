import { api } from '@/api';
import type { RawProject } from '@/api/types';
import { transformControlPlaneStatus } from '@/lib/status/control-plane';
import { ControlPlaneStatus } from '@/lib/status/types';

import { RESOURCE_MANAGER, toMeta } from '../shared';

export interface Project {
  name: string;
  displayName: string;
  description?: string;
  organizationId: string;
  createdAt?: string;
}

/** cloud-portal project.adapter.ts `toProject`. */
export function toProject(raw: RawProject): Project {
  const meta = toMeta(raw);
  return {
    name: meta.name,
    displayName:
      meta.annotations['kubernetes.io/display-name'] ||
      meta.annotations['kubernetes.io/description'] ||
      meta.name,
    description: meta.annotations['kubernetes.io/description'],
    organizationId: raw.spec?.ownerRef?.name ?? '',
    createdAt: meta.createdAt,
  };
}

/** Like the portal's `toProjectList`: only Ready projects, sorted by display name. */
export function toProjectList(items: RawProject[]): Project[] {
  return items
    .filter(
      (p) =>
        !p.metadata?.deletionTimestamp &&
        transformControlPlaneStatus(p.status).status === ControlPlaneStatus.Success
    )
    .map(toProject)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export const projectService = {
  list(orgId: string, signal?: AbortSignal) {
    return api.listResource<RawProject>(
      { kind: 'org', org: orgId },
      { ...RESOURCE_MANAGER, resource: 'projects' },
      { signal, pageSize: 1000 }
    );
  },
};
