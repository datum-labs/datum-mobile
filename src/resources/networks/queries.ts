import { useQuery } from '@tanstack/react-query';

import { useLiveRefetchInterval } from '@/lib/query';

import { networkService, toNetwork, toNetworkList } from './service';

export const networkKeys = {
  all: ['networks'] as const,
  list: (projectId: string) => [...networkKeys.all, 'list', projectId] as const,
  detail: (projectId: string, name: string) => [...networkKeys.all, 'detail', projectId, name] as const,
};

export function useNetworks(projectId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: networkKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => networkService.list(projectId as string, signal),
    select: toNetworkList,
    enabled: !!projectId,
    refetchInterval,
  });
}

export function useNetwork(projectId: string | undefined, name: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: networkKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => networkService.get(projectId as string, name as string, signal),
    select: toNetwork,
    enabled: !!projectId && !!name,
    refetchInterval,
  });
}

