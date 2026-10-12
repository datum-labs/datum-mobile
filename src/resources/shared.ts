import type { RawCondition } from '@/lib/status/types';

/** Metadata fields every view model carries. */
export interface ResourceMeta {
  uid: string;
  name: string;
  /** ISO timestamp (kept as a string so the persisted cache round-trips). */
  createdAt?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

interface RawMeta {
  metadata?: {
    uid?: string;
    name?: string;
    creationTimestamp?: string | Date;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
}

export function toMeta(raw: RawMeta): ResourceMeta {
  const created = raw.metadata?.creationTimestamp;
  return {
    uid: raw.metadata?.uid ?? raw.metadata?.name ?? '',
    name: raw.metadata?.name ?? '',
    createdAt: created ? String(created instanceof Date ? created.toISOString() : created) : undefined,
    labels: raw.metadata?.labels ?? {},
    annotations: raw.metadata?.annotations ?? {},
  };
}

/** Portal display name convention: `app.kubernetes.io/name`, then `kubernetes.io/display-name`. */
export function displayNameOf(meta: ResourceMeta): string {
  return (
    meta.annotations['app.kubernetes.io/name']?.trim() ||
    meta.annotations['kubernetes.io/display-name']?.trim() ||
    meta.name
  );
}

/** Conditions normalised for display (types from different generators disagree on optionality). */
export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason: string;
  message: string;
  lastTransitionTime?: string;
}

export function toConditions(raw: RawCondition[] | null | undefined): Condition[] {
  return (raw ?? []).map((c) => ({
    type: c.type ?? '',
    status: c.status === 'True' || c.status === 'False' ? c.status : 'Unknown',
    reason: c.reason ?? '',
    message: c.message ?? '',
    lastTransitionTime:
      c.lastTransitionTime instanceof Date
        ? c.lastTransitionTime.toISOString()
        : (c.lastTransitionTime ?? undefined),
  }));
}

export const NETWORKING = { group: 'networking.datumapis.com', version: 'v1alpha' } as const;
export const NETWORKING_ALPHA1 = { group: 'networking.datumapis.com', version: 'v1alpha1' } as const;
export const DNS = { group: 'dns.networking.miloapis.com', version: 'v1alpha1' } as const;
export const COMPUTE = { group: 'compute.datumapis.com', version: 'v1alpha' } as const;
export const RESOURCE_MANAGER = { group: 'resourcemanager.miloapis.com', version: 'v1alpha1' } as const;
