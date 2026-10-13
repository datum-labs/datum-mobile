import { api, DEFAULT_NAMESPACE, resourcePath } from '@/api';
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

export interface CreateNetworkInput {
  /** Resource name (DNS-1123 label). */
  name: string;
  displayName: string;
  ipFamilies: ('IPv4' | 'IPv6')[];
}

const MAX_NAME = 63;

/**
 * A resource name from a display name: lowercase DNS-1123 label, with a short
 * suffix when it's already taken in the project.
 */
export function networkNameFor(displayName: string, taken: readonly string[] = []): string {
  const base =
    displayName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_NAME - 5)
      .replace(/-+$/, '') || 'network';
  if (!taken.includes(base)) return base;
  let candidate: string;
  do {
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  } while (taken.includes(candidate));
  return candidate;
}

/** Auto-IPAM network; the platform assigns its IPv6 /48 (and IPv4 range when asked for). */
export function networkManifest({ name, displayName, ipFamilies }: CreateNetworkInput): RawNetwork {
  return {
    apiVersion: `${NETWORKING.group}/${NETWORKING.version}`,
    kind: 'Network',
    metadata: { name, annotations: { 'kubernetes.io/display-name': displayName } },
    spec: { ipFamilies, ipam: { mode: 'Auto' } },
  };
}

const project = (projectId: string) => ({ kind: 'project', project: projectId }) as const;

export const networkService = {
  list(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawNetwork>(
      project(projectId),
      { ...NETWORKING, resource: 'networks', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
  create(projectId: string, input: CreateNetworkInput) {
    return api.post<RawNetwork>(
      resourcePath(project(projectId), { ...NETWORKING, resource: 'networks', namespace: DEFAULT_NAMESPACE }),
      networkManifest(input)
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
