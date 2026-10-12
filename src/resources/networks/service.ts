import { api, DEFAULT_NAMESPACE } from '@/api';
import type { RawNetwork, RawSubnet } from '@/api/types';
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

export interface Subnet extends ResourceMeta {
  network?: string;
  location?: string;
  ipFamily?: string;
  cidr?: string;
  subnetClass?: string;
  view: StatusView;
  conditions: Condition[];
}

export function toSubnet(raw: RawSubnet): Subnet {
  const meta = toMeta(raw);
  const start = raw.status?.startAddress ?? raw.spec?.startAddress;
  const prefix = raw.status?.prefixLength ?? raw.spec?.prefixLength;
  return {
    ...meta,
    network: raw.spec?.networkContext?.name,
    location: raw.spec?.location?.name,
    ipFamily: raw.spec?.ipFamily,
    cidr: start && prefix !== undefined ? `${start}/${prefix}` : undefined,
    subnetClass: raw.spec?.subnetClass,
    view: controlPlaneView(raw.status),
    conditions: toConditions(raw.status?.conditions),
  };
}

export const toSubnetList = (items: RawSubnet[]) =>
  items.map(toSubnet).sort((a, b) => a.name.localeCompare(b.name));

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
  listSubnets(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawSubnet>(
      project(projectId),
      { ...NETWORKING, resource: 'subnets', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
};
