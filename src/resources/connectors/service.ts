import { api, DEFAULT_NAMESPACE } from '@/api';
import type { RawConnector } from '@/api/types';
import type { StatusView } from '@/lib/status/types';
import { connectorView } from '@/lib/status/views';

import { NETWORKING_ALPHA1, toConditions, toMeta, type Condition, type ResourceMeta } from '../shared';

export interface Connector extends ResourceMeta {
  className: string;
  deviceName?: string;
  deviceOs?: string;
  view: StatusView;
  conditions: Condition[];
  capabilities: Array<{ type: string; enabled: boolean; view: StatusView }>;
  homeRelay?: string;
  addresses: string[];
  leaseName?: string;
}

/** cloud-portal connector.adapter.ts `toConnector` plus status/capability views. */
export function toConnector(raw: RawConnector): Connector {
  const meta = toMeta(raw);
  const capabilityStatus = new Map(
    (raw.status?.capabilities ?? []).map((cap) => [cap.type, cap.conditions] as const)
  );
  const publicKey = raw.status?.connectionDetails?.publicKey;
  return {
    ...meta,
    className: raw.spec?.connectorClassName ?? '',
    deviceName: meta.annotations['datum.net/device-name'],
    deviceOs: meta.annotations['datum.net/device-os'],
    view: connectorView(raw.status),
    conditions: toConditions(raw.status?.conditions),
    capabilities: (raw.spec?.capabilities ?? []).map((cap) => {
      const enabled = !cap.connectTCP?.disabled;
      const conditions = capabilityStatus.get(cap.type);
      return {
        type: cap.type,
        enabled,
        view: conditions
          ? connectorView({ conditions })
          : { status: 'unknown' as const, label: enabled ? 'Enabled' : 'Disabled' },
      };
    }),
    homeRelay: publicKey?.homeRelay,
    addresses: (publicKey?.addresses ?? []).map((a) => `${a.address}:${a.port}`),
    leaseName: raw.status?.leaseRef?.name,
  };
}

export const toConnectorList = (items: RawConnector[]) =>
  items
    .map(toConnector)
    .sort((a, b) => (a.deviceName ?? a.name).localeCompare(b.deviceName ?? b.name));

const project = (projectId: string) => ({ kind: 'project', project: projectId }) as const;

export const connectorService = {
  list(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawConnector>(
      project(projectId),
      { ...NETWORKING_ALPHA1, resource: 'connectors', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
  get(projectId: string, name: string, signal?: AbortSignal) {
    return api.getResource<RawConnector>(
      project(projectId),
      { ...NETWORKING_ALPHA1, resource: 'connectors', namespace: DEFAULT_NAMESPACE, name },
      { signal }
    );
  },
};
