import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { HTTP_PROXY_PROVISIONING_POLL_MS } from '@/lib/status/http-proxy-provisioning';
import { useLiveRefetchInterval } from '@/lib/query';

import { toHttpProxy, toHttpProxyList, toWafView } from './model';
import { httpProxyService } from './service';

/** Same shape as cloud-portal `httpProxyKeys`. */
export const httpProxyKeys = {
  all: ['http-proxies'] as const,
  lists: () => [...httpProxyKeys.all, 'list'] as const,
  list: (projectId: string) => [...httpProxyKeys.lists(), projectId] as const,
  details: () => [...httpProxyKeys.all, 'detail'] as const,
  detail: (projectId: string, name: string) => [...httpProxyKeys.details(), projectId, name] as const,
  waf: () => [...httpProxyKeys.all, 'waf'] as const,
  wafList: (projectId: string) => [...httpProxyKeys.waf(), 'list', projectId] as const,
};

export function useHttpProxies(projectId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: httpProxyKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => httpProxyService.list(projectId as string, signal),
    select: toHttpProxyList,
    enabled: !!projectId,
    refetchInterval,
  });
}

export function useHttpProxy(projectId: string | undefined, name: string | undefined) {
  const live = useLiveRefetchInterval();
  return useQuery({
    queryKey: httpProxyKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => httpProxyService.get(projectId as string, name as string, signal),
    select: toHttpProxy,
    enabled: !!projectId && !!name,
    // Poll faster while certificates/DNS are still converging, like the portal.
    refetchInterval: (query) => {
      if (live === false) return false;
      const data = query.state.data;
      return data && toHttpProxy(data).provisioning ? HTTP_PROXY_PROVISIONING_POLL_MS : live;
    },
  });
}

export function useTrafficProtectionPolicies(projectId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: httpProxyKeys.wafList(projectId ?? ''),
    queryFn: ({ signal }) => httpProxyService.listTrafficProtectionPolicies(projectId as string, signal),
    enabled: !!projectId,
    refetchInterval,
  });
}

/** WAF view for one proxy (derived from the shared TPP list). */
export function useProxyWaf(projectId: string | undefined, proxyName: string | undefined) {
  const select = useCallback(
    (data: Parameters<typeof toWafView>[0]) => toWafView(data, proxyName ?? ''),
    [proxyName]
  );
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: httpProxyKeys.wafList(projectId ?? ''),
    queryFn: ({ signal }) => httpProxyService.listTrafficProtectionPolicies(projectId as string, signal),
    select,
    enabled: !!projectId && !!proxyName,
    refetchInterval,
  });
}
