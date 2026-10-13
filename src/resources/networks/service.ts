import { api, DEFAULT_NAMESPACE } from '@/api';
import type { RawNetwork } from '@/api/types';
import type { StatusView } from '@/lib/status/types';
import { controlPlaneView } from '@/lib/status/views';

import { displayNameOf, NETWORKING, toConditions, toMeta, type Condition, type ResourceMeta } from '../shared';

export interface Network extends ResourceMeta {
  displayName: string;
  ipFamilies: string[];
  ipamMode?: string;
  ipv4Range?: string;
  ipv6Range?: string;
  ipv6Prefix?: string;
  mtu?: number;
  view: StatusView;
  conditions: Condition[];
}

export function toNetwork(raw: RawNetwork): Network {
  const meta = toMeta(raw);
  return {
    ...meta,
    displayName: displayNameOf(meta),
    ipFamilies: raw.spec?.ipFamilies ?? [],
    ipamMode: raw.spec?.ipam?.mode,
    ipv4Range: raw.spec?.ipam?.ipv4Range,
    ipv6Range: raw.spec?.ipam?.ipv6Range,
    ipv6Prefix: raw.status?.ipam?.ipv6Prefix,
    mtu: raw.spec?.mtu,
    view: controlPlaneView(raw.status),
    conditions: toConditions(raw.status?.conditions),
  };
}

export const toNetworkList = (items: RawNetwork[]) =>
  items.map(toNetwork).sort((a, b) => a.displayName.localeCompare(b.displayName));

const project = (projectId: string) => ({ kind: 'project', project: projectId }) as const;

export const networkService = {
  list(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawNetwork>(
      project(projectId),
      { ...NETWORKING, resource: 'networks', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
  get(projectId: string, name: string, signal?: AbortSignal) {
    return api.getResource<RawNetwork>(
      project(projectId),
      { ...NETWORKING, resource: 'networks', namespace: DEFAULT_NAMESPACE, name },
      { signal }
    );
  },
};
