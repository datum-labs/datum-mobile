import { useQuery } from '@tanstack/react-query';

import { organizationService, toOrganizationList } from './service';

export const organizationKeys = {
  all: ['organizations'] as const,
  list: (sub: string) => [...organizationKeys.all, 'list', sub] as const,
};

export function useOrganizations(sub: string | undefined) {
  return useQuery({
    queryKey: organizationKeys.list(sub ?? ''),
    queryFn: ({ signal }) => organizationService.listMemberships(sub as string, signal),
    select: toOrganizationList,
    enabled: !!sub,
  });
}
