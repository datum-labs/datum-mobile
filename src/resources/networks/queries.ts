import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useLiveQuery } from '@/lib/query';

import { networkService, toNetwork, toNetworkList, type CreateNetworkInput } from './service';

export const networkKeys = {
  all: ['networks'] as const,
  list: (projectId: string) => [...networkKeys.all, 'list', projectId] as const,
  detail: (projectId: string, name: string) => [...networkKeys.all, 'detail', projectId, name] as const,
};

export function useNetworks(projectId: string | undefined) {
  const { refetchInterval, subscribed } = useLiveQuery();
  return useQuery({
    queryKey: networkKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => networkService.list(projectId as string, signal),
    select: toNetworkList,
    enabled: !!projectId,
    refetchInterval,
    subscribed,
  });
}

/** Polled faster while the network is still being set up (no IPv6 prefix yet). */
const PENDING_REFETCH_MS = 2_000;

export function useNetwork(projectId: string | undefined, name: string | undefined) {
  const { refetchInterval: live, subscribed } = useLiveQuery();
  return useQuery({
    subscribed,
    queryKey: networkKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => networkService.get(projectId as string, name as string, signal),
    select: toNetwork,
    enabled: !!projectId && !!name,
    refetchInterval: (q) =>
      live && q.state.data && !q.state.data.status?.ipam?.ipv6Prefix ? PENDING_REFETCH_MS : live,
  });
}

export function useCreateNetwork(projectId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNetworkInput) => networkService.create(projectId as string, input),
    onSuccess: (raw) => {
      if (raw.metadata?.name) client.setQueryData(networkKeys.detail(projectId ?? '', raw.metadata.name), raw);
      return client.invalidateQueries({ queryKey: networkKeys.list(projectId ?? '') });
    },
  });
}

