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
