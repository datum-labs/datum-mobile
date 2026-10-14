import { api, ApiError, DEFAULT_NAMESPACE } from '@/api';
import type { RawHttpProxy, RawTrafficProtectionPolicy } from '@/api/types';

import { NETWORKING } from '../shared';

const project = (projectId: string) => ({ kind: 'project', project: projectId }) as const;

export const httpProxyService = {
  list(projectId: string, signal?: AbortSignal) {
    return api.listResource<RawHttpProxy>(
      project(projectId),
      { ...NETWORKING, resource: 'httpproxies', namespace: DEFAULT_NAMESPACE },
      { signal }
    );
  },

  get(projectId: string, name: string, signal?: AbortSignal) {
    return api.getResource<RawHttpProxy>(
      project(projectId),
      { ...NETWORKING, resource: 'httpproxies', namespace: DEFAULT_NAMESPACE, name },
      { signal }
    );
  },

  /**
   * Basic auth is an Envoy SecurityPolicy named after the proxy (portal
   * access-card): present = enabled, 404 = off, 403 = can't tell. The
   * htpasswd Secret (for the user count) is deliberately not read: it holds
   * password hashes, which have no business on a phone.
   */
  async basicAuth(projectId: string, name: string, signal?: AbortSignal): Promise<'enabled' | 'disabled' | 'forbidden'> {
    try {
      await api.getResource<unknown>(
        project(projectId),
        { group: 'gateway.envoyproxy.io', version: 'v1alpha1', resource: 'securitypolicies', namespace: DEFAULT_NAMESPACE, name },
        { signal }
      );
      return 'enabled';
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return 'disabled';
      if (error instanceof ApiError && error.status === 403) return 'forbidden';
      throw error;
    }
  },

  /**
   * The load balancer's description: the newest project Note about it
   * (portal general-card). 403 = no access to notes.
   */
  async description(projectId: string, name: string, signal?: AbortSignal): Promise<{ content?: string; forbidden: boolean }> {
    try {
      const notes = await api.listResource<{ metadata?: { creationTimestamp?: string }; spec?: { content?: string } }>(
        project(projectId),
        { group: 'notes.miloapis.com', version: 'v1alpha1', resource: 'notes', namespace: DEFAULT_NAMESPACE },
        { signal, query: { fieldSelector: `spec.subjectRef.name=${name},spec.subjectRef.kind=HTTPProxy` } }
      );
      const newest = [...notes].sort((a, b) =>
        (b.metadata?.creationTimestamp ?? '').localeCompare(a.metadata?.creationTimestamp ?? '')
      )[0];
      return { content: newest?.spec?.content || undefined, forbidden: false };
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) return { forbidden: true };
      if (error instanceof ApiError && error.status === 404) return { forbidden: false };
      throw error;
    }
  },

  /**
   * WAF policies are permission-gated separately from proxies (as in the
   * portal): 403 degrades to `forbidden`, 404 to "none".
   */
  async listTrafficProtectionPolicies(
    projectId: string,
    signal?: AbortSignal
  ): Promise<{ items: RawTrafficProtectionPolicy[]; forbidden: boolean }> {
    try {
      const items = await api.listResource<RawTrafficProtectionPolicy>(
        project(projectId),
        { ...NETWORKING, resource: 'trafficprotectionpolicies', namespace: DEFAULT_NAMESPACE },
        { signal }
      );
      return { items, forbidden: false };
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) return { items: [], forbidden: true };
      if (error instanceof ApiError && error.status === 404) return { items: [], forbidden: false };
      throw error;
    }
  },
};
