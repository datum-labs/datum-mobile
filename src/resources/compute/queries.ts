import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useLiveRefetchInterval } from '@/lib/query';

import {
  computeService,
  connectedAlbsForWorkload,
  toInstance,
  toInstanceList,
  toWorkload,
  toWorkloadDeployment,
  toWorkloadList,
} from './service';
import type { RawWorkloadDeployment } from '@/api/types';

/** Polling while a workload is still coming up (compute plugin's DEPLOYING interval). */
const DEPLOYING_REFETCH_MS = 5_000;

export const workloadKeys = {
  all: ['workloads'] as const,
  list: (projectId: string) => [...workloadKeys.all, 'list', projectId] as const,
  detail: (projectId: string, name: string) => [...workloadKeys.all, 'detail', projectId, name] as const,
  deployments: (projectId: string) => [...workloadKeys.all, 'deployments', projectId] as const,
  albs: (projectId: string) => [...workloadKeys.all, 'albs', projectId] as const,
};

export const instanceKeys = {
  all: ['instances'] as const,
  list: (projectId: string) => [...instanceKeys.all, 'list', projectId] as const,
  forWorkload: (projectId: string, workload: string) =>
    [...instanceKeys.all, 'workload', projectId, workload] as const,
  detail: (projectId: string, name: string) => [...instanceKeys.all, 'detail', projectId, name] as const,
};

export function useWorkloads(projectId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: workloadKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => computeService.listWorkloads(projectId as string, signal),
    select: toWorkloadList,
    enabled: !!projectId,
    refetchInterval,
  });
}

export function useWorkload(projectId: string | undefined, name: string | undefined) {
  const live = useLiveRefetchInterval();
  return useQuery({
    queryKey: workloadKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => computeService.getWorkload(projectId as string, name as string, signal),
    select: toWorkload,
    enabled: !!projectId && !!name,
    refetchInterval: (query) => {
      if (live === false) return false;
      const data = query.state.data;
      if (!data) return live;
      const workload = toWorkload(data);
      return workload.health === 'Deploying' && !workload.deleting ? DEPLOYING_REFETCH_MS : live;
    },
  });
}

export function useWorkloadDeployments(projectId: string | undefined, workloadName: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  const select = useCallback(
    (items: RawWorkloadDeployment[]) =>
      items
        .map(toWorkloadDeployment)
        .filter((d) => d.workloadName === workloadName)
        .sort((a, b) => (a.placement ?? '').localeCompare(b.placement ?? '')),
    [workloadName]
  );
  return useQuery({
    queryKey: workloadKeys.deployments(projectId ?? ''),
    queryFn: ({ signal }) => computeService.listDeployments(projectId as string, signal),
    select,
    enabled: !!projectId && !!workloadName,
    refetchInterval,
  });
}

export function useInstances(projectId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: instanceKeys.list(projectId ?? ''),
    queryFn: ({ signal }) => computeService.listInstances(projectId as string, { signal }),
    select: toInstanceList,
    enabled: !!projectId,
    refetchInterval,
  });
}

export function useWorkloadInstances(projectId: string | undefined, workloadName: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: instanceKeys.forWorkload(projectId ?? '', workloadName ?? ''),
    queryFn: ({ signal }) =>
      computeService.listInstances(projectId as string, { workloadName, signal }),
    select: toInstanceList,
    enabled: !!projectId && !!workloadName,
    refetchInterval,
  });
}

export function useInstance(projectId: string | undefined, name: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: instanceKeys.detail(projectId ?? '', name ?? ''),
    queryFn: ({ signal }) => computeService.getInstance(projectId as string, name as string, signal),
    select: toInstance,
    enabled: !!projectId && !!name,
    refetchInterval,
  });
}

export function useWorkloadAlbs(projectId: string | undefined, workloadName: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  const select = useCallback(
    (inputs: Awaited<ReturnType<typeof computeService.listAlbInputs>>) =>
      connectedAlbsForWorkload(inputs, workloadName ?? ''),
    [workloadName]
  );
  return useQuery({
    queryKey: workloadKeys.albs(projectId ?? ''),
    queryFn: ({ signal }) => computeService.listAlbInputs(projectId as string, signal),
    select,
    enabled: !!projectId && !!workloadName,
    refetchInterval,
  });
}
