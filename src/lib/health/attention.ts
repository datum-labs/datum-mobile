import type { SymbolViewProps } from 'expo-symbols';

import type { StatusView } from '@/lib/status/types';
import { workloadView } from '@/lib/status/views';
import type { Workload } from '@/resources/compute/model';
import type { DnsZone } from '@/resources/dns/service';
import type { Domain } from '@/resources/domains/service';
import type { HttpProxy } from '@/resources/http-proxies/model';

/** The resource kinds Home's "Needs attention" lists, in its order. */
export type AttentionKind = 'alb' | 'workload' | 'domain' | 'dns';

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  /** Resource name (the route parameter). */
  name: string;
  title: string;
  subtitle: string;
  icon: SymbolViewProps['name'];
  view: StatusView;
  /** expo-router path of the resource's screen. */
  path: string;
}

export interface AttentionInput {
  proxies?: HttpProxy[];
  workloads?: Workload[];
  domains?: Domain[];
  zones?: DnsZone[];
}

const KIND: Record<AttentionKind, { subtitle: string; icon: SymbolViewProps['name']; segment: string }> = {
  alb: { subtitle: 'Load balancer', icon: 'arrow.triangle.branch', segment: 'alb' },
  workload: { subtitle: 'Workload', icon: 'shippingbox.fill', segment: 'workloads' },
  domain: { subtitle: 'Domain', icon: 'globe', segment: 'domains' },
  dns: { subtitle: 'DNS zone', icon: 'list.bullet.rectangle', segment: 'dns' },
};

/** The screen for a resource: `/alb/:id`, `/workloads/:name`, `/domains/:id`, `/dns/:id`. */
export function resourcePath(kind: AttentionKind, name: string): string {
  return `/${KIND[kind].segment}/${encodeURIComponent(name)}`;
}

const needs = (view: StatusView) => view.status === 'error' || view.status === 'pending';

const RANK = { error: 0, pending: 1, unknown: 2, success: 3 } as const;

/**
 * Home's "Needs attention": failing or pending ALBs, workloads and DNS zones,
 * plus unverified domains; errors first. Not truncated (Home shows six, the
 * widget three or four).
 */
export function attentionItems(input: AttentionInput, now = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (kind: AttentionKind, name: string, title: string, view: StatusView) =>
    items.push({
      key: `${kind}/${name}`,
      kind,
      name,
      title,
      subtitle: KIND[kind].subtitle,
      icon: KIND[kind].icon,
      view,
      path: resourcePath(kind, name),
    });
  for (const p of input.proxies ?? []) if (needs(p.view)) add('alb', p.name, p.displayName, p.view);
  for (const w of input.workloads ?? []) {
    const view = workloadView(w, now);
    if (needs(view)) add('workload', w.name, w.name, view);
  }
  // The portal shows an unverified domain as needing work, but not a pending one.
  for (const d of input.domains ?? []) if (d.view.status === 'error') add('domain', d.name, d.domainName, d.view);
  for (const z of input.zones ?? []) if (needs(z.view)) add('dns', z.name, z.domainName, z.view);
  // Stable sort: within a rank, the order above (ALBs, workloads, domains, zones).
  return items.sort((a, b) => RANK[a.view.status] - RANK[b.view.status]);
}
