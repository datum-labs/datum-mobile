import { api, DEFAULT_NAMESPACE } from '@/api';
import type { RawDnsRecordSet, RawDnsZone } from '@/api/types';
import { formatDnsError } from '@/lib/status/dns-errors';
import type { StatusView } from '@/lib/status/types';
import { controlPlaneView } from '@/lib/status/views';

import { DNS, toConditions, toMeta, type Condition, type ResourceMeta } from '../shared';

export interface DnsZone extends ResourceMeta {
  domainName: string;
  zoneClass: string;
  view: StatusView;
  conditions: Condition[];
  nameservers: string[];
  recordCount?: number;
}

export function toDnsZone(raw: RawDnsZone): DnsZone {
  const meta = toMeta(raw);
  return {
    ...meta,
    domainName: raw.spec?.domainName ?? meta.name,
    zoneClass: raw.spec?.dnsZoneClassName ?? '',
    view: controlPlaneView(raw.status, { success: 'Ready' }),
    conditions: toConditions(raw.status?.conditions),
    nameservers: raw.status?.nameservers ?? [],
    recordCount: raw.status?.recordCount,
  };
}

export const toDnsZoneList = (items: RawDnsZone[]) =>
  items.map(toDnsZone).sort((a, b) => a.domainName.localeCompare(b.domainName));

/** One record line in a record set, flattened for display. */
export interface DnsRecord {
  key: string;
  recordSet: string;
  name: string;
  type: string;
  value: string;
  ttl?: number;
  view: StatusView;
}

type RawRecord = RawDnsRecordSet['spec']['records'][number];

function recordValue(type: string, r: RawRecord): string {
  switch (type) {
    case 'A':
      return r.a?.content ?? '';
    case 'AAAA':
      return r.aaaa?.content ?? '';
    case 'CNAME':
      return r.cname?.content ?? '';
    case 'ALIAS':
      // Not in the generated type yet; served as `alias.content` (see portal flatten.helper.ts).
      return (r as RawRecord & { alias?: { content?: string } }).alias?.content ?? '';
    case 'TXT':
      return r.txt?.content ?? '';
    case 'NS':
      return r.ns?.content ?? '';
    case 'PTR':
      return r.ptr?.content ?? '';
    case 'MX':
      return r.mx ? `${r.mx.preference} ${r.mx.exchange}` : '';
    case 'SRV':
      return r.srv ? `${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${r.srv.target}` : '';
    case 'CAA':
      return r.caa ? `${r.caa.flag} ${r.caa.tag} "${r.caa.value}"` : '';
    case 'TLSA':
      return r.tlsa ? `${r.tlsa.usage} ${r.tlsa.selector} ${r.tlsa.matchingType} ${r.tlsa.certData}` : '';
    case 'HTTPS':
    case 'SVCB': {
      const v = type === 'HTTPS' ? r.https : r.svcb;
      if (!v) return '';
      const params = Object.entries(v.params ?? {})
        .map(([k, val]) => `${k}=${val}`)
        .join(' ');
      return `${v.priority} ${v.target}${params ? ` ${params}` : ''}`;
    }
    case 'SOA':
      return r.soa ? `${r.soa.mname} ${r.soa.rname}` : '';
    default:
      return '';
  }
}

/** Record sets → one row per record, like the portal's flattened DNS table. */
export function toDnsRecords(items: RawDnsRecordSet[]): DnsRecord[] {
  const rows: DnsRecord[] = [];
  for (const set of items) {
    const meta = toMeta(set);
    const type = set.spec?.recordType ?? '';
    const base = controlPlaneView(set.status, { success: 'Active' });
    const view = base.detail ? { ...base, detail: formatDnsError(base.detail) } : base;
    (set.spec?.records ?? []).forEach((record, i) => {
      rows.push({
        key: `${meta.name}/${i}`,
        recordSet: meta.name,
        name: record.name,
        type,
        value: recordValue(type, record),
        ttl: record.ttl !== undefined ? Number(record.ttl) : undefined,
        view,
      });
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

const project = (projectId: string) => ({ kind: 'project', project: projectId }) as const;

export const dnsService = {
  listZones(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawDnsZone>(
      project(projectId),
      { ...DNS, resource: 'dnszones', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },
  getZone(projectId: string, name: string, signal?: AbortSignal) {
    return api.getResource<RawDnsZone>(
      project(projectId),
      { ...DNS, resource: 'dnszones', namespace: DEFAULT_NAMESPACE, name },
      { signal }
    );
  },
  /** Record sets in one zone (server-side field selector, as the portal does). */
  listRecordSets(projectId: string, zoneName: string, signal?: AbortSignal) {
    return api.listResource<RawDnsRecordSet>(
      project(projectId),
      { ...DNS, resource: 'dnsrecordsets', namespace: DEFAULT_NAMESPACE },
      { signal, query: { fieldSelector: `spec.dnsZoneRef.name=${zoneName}` } }
    );
  },
};
