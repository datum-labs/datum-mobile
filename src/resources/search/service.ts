import { api, projectScopedBase } from '@/api';

/**
 * Milo search (search.miloapis.com), as the portal's project search uses it
 * (cloud-portal `app/resources/search`): POST a ResourceSearchQuery to the
 * project's control plane; its `status.results` are the hits, best first.
 * Like ActivityQuery it's a virtual, read-only object.
 */
export const SEARCH_QUERIES_PATH = '/apis/search.miloapis.com/v1alpha1/resourcesearchqueries';

export interface SearchTarget {
  group: string;
  version: string;
  kind: string;
}

/**
 * Kinds with a ResourceIndexPolicy (the portal's PROJECT_KINDS) that the app
 * has a screen for. ExportPolicy is indexed too, but the app doesn't show
 * export policies.
 */
export const SEARCH_KINDS: SearchTarget[] = [
  { group: 'networking.datumapis.com', version: 'v1alpha', kind: 'HTTPProxy' },
  { group: 'networking.datumapis.com', version: 'v1alpha', kind: 'Domain' },
  { group: 'dns.networking.miloapis.com', version: 'v1alpha1', kind: 'DNSZone' },
];

/** The portal's request size. */
export const SEARCH_LIMIT = 25;

// ── Raw API types (search OpenAPI) ───────────────────────────────────────

export interface RawSearchHit {
  resource?: {
    apiVersion?: string;
    kind?: string;
    metadata?: { uid?: string; name?: string; namespace?: string; annotations?: Record<string, string> };
    spec?: { domainName?: string };
  };
  relevanceScore?: number;
  tenant?: { name?: string; type?: string };
}

export interface ResourceSearchQuery {
  apiVersion: 'search.miloapis.com/v1alpha1';
  kind: 'ResourceSearchQuery';
  metadata: { name: string };
  spec: { query: string; limit: number; targetResources: SearchTarget[] };
  status?: { results?: RawSearchHit[]; continue?: string; deniedTargetResources?: SearchTarget[] };
}

// ── View model ───────────────────────────────────────────────────────────

export interface SearchHit {
  uid: string;
  name: string;
  kind: string;
  /** Domain + DNSZone: the domain; HTTPProxy: its display name annotation. */
  displayName?: string;
  description?: string;
  relevanceScore: number;
  tenant: string;
}

/** cloud-portal `toSearchHit`. */
export function toSearchHit(raw: RawSearchHit): SearchHit {
  const metadata = raw.resource?.metadata ?? {};
  return {
    uid: metadata.uid ?? '',
    name: metadata.name ?? '',
    kind: raw.resource?.kind ?? '',
    displayName:
      raw.resource?.spec?.domainName ||
      metadata.annotations?.['app.kubernetes.io/name'] ||
      metadata.annotations?.['kubernetes.io/display-name'] ||
      undefined,
    description: metadata.annotations?.['kubernetes.io/description'] || undefined,
    relevanceScore: raw.relevanceScore ?? 0,
    tenant: raw.tenant?.name ?? '',
  };
}

/**
 * Hits for this project only. The portal drops hits from other tenants as
 * defence in depth while the server-side tenant filter is wired up; so does
 * the app, before anything is cached or shown.
 */
export function toSearchHits(query: ResourceSearchQuery, projectId: string): SearchHit[] {
  return (query.status?.results ?? [])
    .map(toSearchHit)
    .filter((hit) => hit.tenant === projectId && hit.name !== '');
}

export const searchService = {
  async inProject(projectId: string, query: string, signal?: AbortSignal): Promise<SearchHit[]> {
    const body: ResourceSearchQuery = {
      apiVersion: 'search.miloapis.com/v1alpha1',
      kind: 'ResourceSearchQuery',
      metadata: { name: `search-${Date.now()}` },
      spec: { query, limit: SEARCH_LIMIT, targetResources: SEARCH_KINDS },
    };
    const result = await api.post<ResourceSearchQuery>(`${projectScopedBase(projectId)}${SEARCH_QUERIES_PATH}`, body, {
      signal,
    });
    return toSearchHits(result, projectId);
  },
};
