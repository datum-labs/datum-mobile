import type { SymbolViewProps } from 'expo-symbols';

import type { StatusView } from '@/lib/status/types';
import { instanceView, workloadView } from '@/lib/status/views';
import type { Instance, Workload } from '@/resources/compute/model';
import type { Connector } from '@/resources/connectors/service';
import type { DnsZone } from '@/resources/dns/service';
import type { Domain } from '@/resources/domains/service';
import type { HttpProxy } from '@/resources/http-proxies/model';
import type { Network } from '@/resources/networks/service';

import type { SearchHit } from './service';

/** Results shown per kind (the portal's GROUP_RESULT_CAP). */
export const GROUP_RESULT_CAP = 5;

export type SearchKind = 'alb' | 'domain' | 'dnsZone' | 'workload' | 'instance' | 'network' | 'connector';

/** Group order and labels, matching the tabs: Edge, then Compute, then Network. */
export const SEARCH_GROUPS: { kind: SearchKind; title: string; icon: SymbolViewProps['name'] }[] = [
  { kind: 'alb', title: 'Load balancers', icon: 'arrow.triangle.branch' },
  { kind: 'domain', title: 'Domains', icon: 'globe' },
  { kind: 'dnsZone', title: 'DNS zones', icon: 'list.bullet.rectangle' },
  { kind: 'workload', title: 'Workloads', icon: 'shippingbox.fill' },
  { kind: 'instance', title: 'Instances', icon: 'cpu' },
  { kind: 'network', title: 'Networks', icon: 'point.3.filled.connected.trianglepath.dotted' },
  { kind: 'connector', title: 'Connectors', icon: 'cable.connector' },
];

const SERVER_KIND: Record<string, SearchKind> = { HTTPProxy: 'alb', Domain: 'domain', DNSZone: 'dnsZone' };

const ROUTE: Record<SearchKind, string> = {
  alb: '/alb',
  domain: '/domains',
  dnsZone: '/dns',
  workload: '/workloads',
  instance: '/instances',
  network: '/networks',
  connector: '/connectors',
};

export interface SearchItem {
  /** `kind/name`: unique across groups. */
  key: string;
  kind: SearchKind;
  name: string;
  title: string;
  subtitle?: string;
  href: string;
  status?: StatusView;
}

export interface SearchGroup {
  kind: SearchKind;
  title: string;
  icon: SymbolViewProps['name'];
  items: SearchItem[];
  /** More matched than the group shows. */
  more: number;
}

/** The project's lists as cached for the tabs; missing ones are skipped. */
export interface SearchLists {
  proxies?: HttpProxy[];
  domains?: Domain[];
  zones?: DnsZone[];
  workloads?: Workload[];
  instances?: Instance[];
  networks?: Network[];
  connectors?: Connector[];
}

function item(kind: SearchKind, name: string, title: string, subtitle?: string, status?: StatusView): SearchItem {
  return {
    key: `${kind}/${name}`,
    kind,
    name,
    title,
    subtitle: subtitle && subtitle !== title ? subtitle : undefined,
    href: `${ROUTE[kind]}/${encodeURIComponent(name)}`,
    status,
  };
}

/** Every searchable thing in the lists, with the text it matches on. */
function candidates(lists: SearchLists): { item: SearchItem; text: string[] }[] {
  const out: { item: SearchItem; text: string[] }[] = [];
  for (const p of lists.proxies ?? []) {
    out.push({
      item: item('alb', p.name, p.displayName, p.canonicalHostname ?? p.hostnames[0], p.view),
      text: [p.name, p.displayName, ...p.hostnames, p.canonicalHostname ?? ''],
    });
  }
  for (const d of lists.domains ?? []) {
    out.push({ item: item('domain', d.name, d.domainName, d.name, d.view), text: [d.name, d.domainName] });
  }
  for (const z of lists.zones ?? []) {
    out.push({ item: item('dnsZone', z.name, z.domainName, z.name, z.view), text: [z.name, z.domainName] });
  }
  for (const w of lists.workloads ?? []) {
    out.push({
      item: item('workload', w.name, w.name, w.image, workloadView(w)),
      text: [w.name, w.image ?? '', ...w.locations],
    });
  }
  for (const i of lists.instances ?? []) {
    out.push({
      item: item('instance', i.name, i.name, [i.workloadName, i.location].filter(Boolean).join(' · '), instanceView(i)),
      text: [i.name, i.workloadName ?? '', i.location ?? '', i.externalIP ?? '', i.internalIP ?? ''],
    });
  }
  for (const n of lists.networks ?? []) {
    out.push({
      item: item('network', n.name, n.displayName, n.ipv6Prefix ?? n.name, n.view),
      text: [n.name, n.displayName, n.ipv6Prefix ?? ''],
    });
  }
  for (const c of lists.connectors ?? []) {
    out.push({
      item: item('connector', c.name, c.deviceName ?? c.name, c.deviceName ? c.name : c.className, c.view),
      text: [c.name, c.deviceName ?? '', c.className],
    });
  }
  return out;
}

/** Every word of the query appears somewhere in the text (case-insensitive). */
export function matches(text: string[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = text.join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Search results, grouped like the portal's: Milo's hits first, in its
 * relevance order, then whatever else in the project's lists matches the
 * query (kinds the index doesn't cover yet, and anything it missed or
 * hasn't indexed). A hit for something the lists know takes its status and
 * names from there.
 */
export function searchResults(query: string, hits: SearchHit[] | undefined, lists: SearchLists): SearchGroup[] {
  const all = candidates(lists);
  const known = new Map(all.map((c) => [c.item.key, c.item]));
  const seen = new Set<string>();
  const byKind = new Map<SearchKind, SearchItem[]>();
  const add = (next: SearchItem) => {
    if (seen.has(next.key)) return;
    seen.add(next.key);
    byKind.set(next.kind, [...(byKind.get(next.kind) ?? []), next]);
  };

  for (const hit of hits ?? []) {
    const kind = SERVER_KIND[hit.kind];
    if (!kind) continue;
    add(known.get(`${kind}/${hit.name}`) ?? item(kind, hit.name, hit.displayName ?? hit.name, hit.name));
  }
  for (const c of all) {
    if (matches(c.text, query)) add(c.item);
  }

  return SEARCH_GROUPS.flatMap((group) => {
    const items = byKind.get(group.kind) ?? [];
    if (items.length === 0) return [];
    return [{ ...group, items: items.slice(0, GROUP_RESULT_CAP), more: Math.max(0, items.length - GROUP_RESULT_CAP) }];
  });
}
