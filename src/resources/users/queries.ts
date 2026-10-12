import { useQuery } from '@tanstack/react-query';

import { toUserProfile, userService } from './service';

export const userKeys = {
  all: ['users'] as const,
  detail: (sub: string) => [...userKeys.all, sub] as const,
};

export function useUserProfile(sub: string | undefined) {
  return useQuery({
    queryKey: userKeys.detail(sub ?? ''),
    queryFn: ({ signal }) => userService.get(sub as string, signal),
    select: toUserProfile,
    enabled: !!sub,
    staleTime: 10 * 60_000,
  });
}
