import { api, ApiError, DEFAULT_NAMESPACE } from '@/api';
import type {
  RawHttpProxy,
  RawInstance,
  RawNetworkService,
  RawWorkload,
  RawWorkloadDeployment,
} from '@/api/types';
import type { ConnectedAlb, ResourceCondition } from '@/lib/status/alb-status';
import type { StatusView } from '@/lib/status/types';
import { controlPlaneView } from '@/lib/status/views';

import { COMPUTE, NETWORKING, toConditions, toMeta, type Condition, type ResourceMeta } from '../shared';
import {
  INSTANCE_LABELS,
  toInstance as adaptInstance,
  toWorkload as adaptWorkload,
  type RawInstance as AdapterRawInstance,
  type RawWorkload as AdapterRawWorkload,
} from './adapter';
import type { Instance, Workload } from './model';

// The compute adapter was written against hand-typed Raw* shapes that match
// the API's JSON; the generated types describe the same objects.
export const toWorkload = (raw: RawWorkload): Workload =>
  adaptWorkload(raw as unknown as AdapterRawWorkload);
export const toInstance = (raw: RawInstance): Instance =>
  adaptInstance(raw as unknown as AdapterRawInstance);

/** Newest first, as the compute plugin lists them. */
export const toWorkloadList = (items: RawWorkload[]) =>
  items.map(toWorkload).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

export const toInstanceList = (items: RawInstance[]) =>
  items.map(toInstance).sort((a, b) => a.name.localeCompare(b.name));

export interface WorkloadDeployment extends ResourceMeta {
  workloadName?: string;
  placement?: string;
  cityCode?: string;
  location?: string;
  replicas: number;
  currentReplicas: number;
  desiredReplicas: number;
  view: StatusView;
  conditions: Condition[];
}

export function toWorkloadDeployment(raw: RawWorkloadDeployment): WorkloadDeployment {
  const meta = toMeta(raw);
  return {
    ...meta,
    workloadName: raw.spec?.workloadRef?.name,
    placement: raw.spec?.placementName,
    cityCode: raw.spec?.cityCode,
    location: raw.status?.location?.name,
    replicas: raw.status?.replicas ?? 0,
    currentReplicas: raw.status?.currentReplicas ?? 0,
    desiredReplicas: raw.status?.desiredReplicas ?? 0,
    view: controlPlaneView(raw.status, { success: 'Available' }),
    conditions: toConditions(raw.status?.conditions),
  };
}

const project = (projectId: string) => ({ kind: 'project', project: projectId }) as const;

async function listOrEmpty<T>(fn: () => Promise<T[]>): Promise<T[] | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

export const computeService = {
  listWorkloads(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawWorkload>(
      project(projectId),
      { ...COMPUTE, resource: 'workloads', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
  getWorkload(projectId: string, name: string, signal?: AbortSignal) {
    return api.getResource<RawWorkload>(
      project(projectId),
      { ...COMPUTE, resource: 'workloads', namespace: DEFAULT_NAMESPACE, name },
      { signal }
    );
  },
  listDeployments(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawWorkloadDeployment>(
      project(projectId),
      { ...COMPUTE, resource: 'workloaddeployments', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
  listInstances(projectId: string, opts: { workloadName?: string; signal?: AbortSignal } = {}) {
    return api.listResource<RawInstance>(
      project(projectId),
      { ...COMPUTE, resource: 'instances', namespace: DEFAULT_NAMESPACE },
      {
        signal: opts.signal,
        query: opts.workloadName
          ? { labelSelector: `${INSTANCE_LABELS.workloadName}=${opts.workloadName}` }
          : undefined,
      }
    );
  },
  getInstance(projectId: string, name: string, signal?: AbortSignal) {
    return api.getResource<RawInstance>(
      project(projectId),
      { ...COMPUTE, resource: 'instances', namespace: DEFAULT_NAMESPACE, name },
      { signal }
    );
  },
  /** HTTPProxies + NetworkServices, for "which ALB fronts which workload". Null when not readable. */
  async listAlbInputs(projectId: string, signal?: AbortSignal) {
    const [services, proxies] = await Promise.all([
      listOrEmpty(() =>
        api.listResource<RawNetworkService>(
          project(projectId),
          { ...NETWORKING, resource: 'networkservices', namespace: DEFAULT_NAMESPACE },
          { signal }
        )
      ),
      listOrEmpty(() =>
        api.listResource<RawHttpProxy>(
          project(projectId),
          { ...NETWORKING, resource: 'httpproxies', namespace: DEFAULT_NAMESPACE },
          { signal }
        )
      ),
    ]);
    return { services, proxies };
  },
};

// ── Connected ALBs (compute ui/consumer/src/lib/api.ts) ───────────────────

type NetworkServiceLike = {
  metadata?: { name?: string; labels?: Record<string, string> };
  spec?: { networkInterfaces?: { selector?: { matchLabels?: Record<string, string> } } };
  status?: { conditions?: ResourceCondition[] };
};

type ProxyLike = {
  metadata?: {
    name?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: { hostnames?: string[]; rules?: Array<{ backends?: Array<{ networkService?: { name?: string } }> }> };
  status?: { canonicalHostname?: string; conditions?: ResourceCondition[] };
};

function proxyNetworkServiceNames(proxy: ProxyLike): string[] {
  const names: string[] = [];
  for (const rule of proxy.spec?.rules ?? []) {
    for (const backend of rule.backends ?? []) {
      if (backend.networkService?.name) names.push(backend.networkService.name);
    }
  }
  return names;
}

function workloadNameForService(svc: NetworkServiceLike): string | undefined {
  return (
    svc.metadata?.labels?.[INSTANCE_LABELS.workloadName] ||
    svc.spec?.networkInterfaces?.selector?.matchLabels?.[INSTANCE_LABELS.workloadName]
  );
}

function toConnectedAlb(proxy: ProxyLike, services: NetworkServiceLike[]): ConnectedAlb | null {
  const proxyName = proxy.metadata?.name ?? '';
  if (!proxyName) return null;
  const hostname = proxy.status?.canonicalHostname || proxy.spec?.hostnames?.[0];
  const annotations = proxy.metadata?.annotations;
  const created = proxy.metadata?.creationTimestamp;
  return {
    proxyName,
    hostname,
    customHostnames: [...new Set((proxy.spec?.hostnames ?? []).map((h) => h.trim()))].filter(
      (h) => h && h !== hostname
    ),
    displayName:
      annotations?.['app.kubernetes.io/name']?.trim() ||
      annotations?.['kubernetes.io/display-name']?.trim() ||
      proxyName,
    createdAt: created ? new Date(created) : undefined,
    conditions: proxy.status?.conditions ?? [],
    services: services.map((svc) => ({
      name: svc.metadata?.name ?? '',
      ready: svc.status?.conditions?.find((c) => c.type === 'Ready'),
    })),
  };
}

/**
 * ALBs that reach a workload: labelled with its name, or backed by a
 * NetworkService selecting its interfaces (compute `indexWorkloadProxies`).
 */
export function connectedAlbsForWorkload(
  inputs: { services: RawNetworkService[] | null; proxies: RawHttpProxy[] | null },
  workloadName: string
): ConnectedAlb[] {
  const services = (inputs.services ?? []) as unknown as NetworkServiceLike[];
  const proxies = (inputs.proxies ?? []) as unknown as ProxyLike[];
  const own = new Map(
    services
      .filter((svc) => workloadNameForService(svc) === workloadName && svc.metadata?.name)
      .map((svc) => [svc.metadata?.name as string, svc])
  );
  const albs: ConnectedAlb[] = [];
  for (const proxy of proxies) {
    if (!proxy.metadata?.name) continue;
    const nsNames = [...new Set(proxyNetworkServiceNames(proxy))];
    const labelled = proxy.metadata.labels?.[INSTANCE_LABELS.workloadName] === workloadName;
    const viaService = nsNames.some((name) => own.has(name));
    if (!labelled && !viaService) continue;
    const alb = toConnectedAlb(
      proxy,
      nsNames.flatMap((name) => (own.has(name) ? [own.get(name) as NetworkServiceLike] : []))
    );
    if (alb) albs.push(alb);
  }
  return albs;
}
