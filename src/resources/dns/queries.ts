import { useQuery } from '@tanstack/react-query';

import { useLiveRefetchInterval } from '@/lib/query';

import { dnsService, toDnsRecords, toDnsZone, toDnsZoneList } from './service';

export const dnsZoneKeys = {
  all: ['dns-zones'] as const,
  list: (projectId: string) => [...dnsZoneKeys.all, 'list', projectId] as const,
  detail: (projectId: string, name: string) => [...dnsZoneKeys.all, 'detail', projectId, name] as const,
};

export const dnsRecordKeys = {
  all: ['dns-records'] as const,
  list: (projectId: string, zone: string) => [...dnsRecordKeys.all, 'list', projectId, zone] as const,
};

export function useDnsZones(projectId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: dnsZoneKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => dnsService.listZones(projectId as string, signal),
    select: toDnsZoneList,
    enabled: !!projectId,
    refetchInterval,
  });
}

export function useDnsZone(projectId: string | undefined, name: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: dnsZoneKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => dnsService.getZone(projectId as string, name as string, signal),
    select: toDnsZone,
    enabled: !!projectId && !!name,
    refetchInterval,
  });
}

export function useDnsRecords(projectId: string | undefined, zone: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: dnsRecordKeys.list(projectId ?? '', zone ?? ''),
    queryFn: ({ signal }) => dnsService.listRecordSets(projectId as string, zone as string, signal),
    select: toDnsRecords,
    enabled: !!projectId && !!zone,
    refetchInterval,
  });
}
