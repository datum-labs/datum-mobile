import { api } from '@/api';
import type { RawOrganizationMembership } from '@/api/types';

import { RESOURCE_MANAGER } from '../shared';

export interface Organization {
  /** Organization resource name (used in org-scoped paths). */
  name: string;
  displayName: string;
  type?: 'Personal' | 'Standard';
  status: 'Active' | 'Pending' | 'Suspended' | 'Deleting';
}

type Condition = { type?: string; status?: string; reason?: string };

/** Ported from cloud-portal organization.adapter.ts `mapStatusFromConditions`. */
function mapStatusFromConditions(conditions?: Condition[]): Organization['status'] {
  const ready = conditions?.find((c) => c.type === 'Ready');
  if (!ready) return 'Pending';
  if (ready.status === 'True') return 'Active';
  if (ready.reason === 'Suspended') return 'Suspended';
  if (ready.reason === 'Deleting') return 'Deleting';
  return 'Pending';
}

function normalizeType(type: unknown): Organization['type'] {
  return type === 'Personal' || type === 'Standard' ? type : undefined;
}

/** cloud-portal `toOrganizationFromMembership`. */
export function toOrganizationFromMembership(raw: RawOrganizationMembership): Organization {
  const name = raw.spec?.organizationRef?.name ?? '';
  return {
    name,
    displayName: raw.status?.organization?.displayName || name,
    type: normalizeType(raw.status?.organization?.type),
    status: mapStatusFromConditions(raw.status?.conditions as Condition[] | undefined),
  };
}

/** Same filter and order as the portal: drop deleting orgs, Personal first, then by name. */
export function toOrganizationList(items: RawOrganizationMembership[]): Organization[] {
  return items
    .map(toOrganizationFromMembership)
    .filter((org) => org.name && org.status !== 'Deleting')
    .sort((a, b) => {
      if (a.type === 'Personal' && b.type !== 'Personal') return -1;
      if (b.type === 'Personal' && a.type !== 'Personal') return 1;
      return (a.displayName || a.name).localeCompare(b.displayName || b.name);
    });
}

export const organizationService = {
  /** The user's org memberships, from the user control plane (cluster-wide list). */
  listMemberships(sub: string, signal?: AbortSignal) {
    return api.listResource<RawOrganizationMembership>(
      { kind: 'user', sub },
      { ...RESOURCE_MANAGER, resource: 'organizationmemberships' },
      { signal, pageSize: 1000 }
    );
  },
};
