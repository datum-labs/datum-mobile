import { useQuery } from '@tanstack/react-query';

import { useLiveQuery } from '@/lib/query';

import { connectorService, toConnector, toConnectorList } from './service';

export const connectorKeys = {
  all: ['connectors'] as const,
  list: (projectId: string) => [...connectorKeys.all, 'list', projectId] as const,
  detail: (projectId: string, name: string) => [...connectorKeys.all, 'detail', projectId, name] as const,
};

export function useConnectors(projectId: string | undefined) {
  const { refetchInterval, subscribed } = useLiveQuery();
  return useQuery({
    queryKey: connectorKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => connectorService.list(projectId as string, signal),
    select: toConnectorList,
    enabled: !!projectId,
    refetchInterval,
    subscribed,
  });
}

export function useConnector(projectId: string | undefined, name: string | undefined) {
  const { refetchInterval, subscribed } = useLiveQuery();
  return useQuery({
    queryKey: connectorKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => connectorService.get(projectId as string, name as string, signal),
    select: toConnector,
    enabled: !!projectId && !!name,
    refetchInterval,
    subscribed,
  });
}
