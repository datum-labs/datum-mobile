import { useQuery } from '@tanstack/react-query';

import { useLiveRefetchInterval } from '@/lib/query';

import { domainService, toDomain, toDomainList } from './service';

export const domainKeys = {
  all: ['domains'] as const,
  list: (projectId: string) => [...domainKeys.all, 'list', projectId] as const,
  detail: (projectId: string, name: string) => [...domainKeys.all, 'detail', projectId, name] as const,
};

export function useDomains(projectId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: domainKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => domainService.list(projectId as string, signal),
    select: toDomainList,
    enabled: !!projectId,
    refetchInterval,
  });
}

export function useDomain(projectId: string | undefined, name: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: domainKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => domainService.get(projectId as string, name as string, signal),
    select: toDomain,
    enabled: !!projectId && !!name,
    refetchInterval,
  });
}
