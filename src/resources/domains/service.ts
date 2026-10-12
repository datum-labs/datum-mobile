import { api, DEFAULT_NAMESPACE } from '@/api';
import type { RawDomain } from '@/api/types';
import type { StatusView } from '@/lib/status/types';
import { domainView } from '@/lib/status/views';

import { NETWORKING, toConditions, toMeta, type Condition, type ResourceMeta } from '../shared';

export interface Domain extends ResourceMeta {
  domainName: string;
  view: StatusView;
  conditions: Condition[];
  apex?: boolean;
  nameservers: string[];
  registrar?: string;
  expiresAt?: string;
  verificationRecord?: { name: string; type: string; content: string };
  verificationHttp?: { url: string; body: string };
}

export function toDomain(raw: RawDomain): Domain {
  const meta = toMeta(raw);
  return {
    ...meta,
    domainName: raw.spec?.domainName ?? meta.name,
    view: domainView(raw.status),
    conditions: toConditions(raw.status?.conditions),
    apex: raw.status?.apex,
    nameservers: (raw.status?.nameservers ?? []).map((ns) => ns.hostname),
    registrar: raw.status?.registration?.registrar?.name,
    expiresAt: raw.status?.registration?.expiresAt,
    verificationRecord: raw.status?.verification?.dnsRecord,
    verificationHttp: raw.status?.verification?.httpToken,
  };
}

export const toDomainList = (items: RawDomain[]) =>
  items.map(toDomain).sort((a, b) => a.domainName.localeCompare(b.domainName));

const project = (projectId: string) => ({ kind: 'project', project: projectId }) as const;

export const domainService = {
  list(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawDomain>(
      project(projectId),
      { ...NETWORKING, resource: 'domains', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
  get(projectId: string, name: string, signal?: AbortSignal) {
    return api.getResource<RawDomain>(
      project(projectId),
      { ...NETWORKING, resource: 'domains', namespace: DEFAULT_NAMESPACE, name },
      { signal }
    );
  },
};
