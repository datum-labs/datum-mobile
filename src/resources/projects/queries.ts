import { useQuery } from '@tanstack/react-query';

import { projectService, toProjectList } from './service';

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (orgId: string) => [...projectKeys.lists(), orgId] as const,
};

export function useProjects(orgId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.list(orgId ?? ''),
    queryFn: ({ signal }) => projectService.list(orgId as string, signal),
    select: toProjectList,
    enabled: !!orgId,
  });
}
