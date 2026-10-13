import type { ChatSummary } from '@datum-cloud/datum-ui-assistant-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { assistantService } from './service';
import { env } from '@/config/env';

export const assistantKeys = {
  all: ['assistant'] as const,
  endpoint: (projectId: string) => [...assistantKeys.all, 'endpoint', projectId] as const,
  conversations: (projectId: string) => [...assistantKeys.all, 'conversations', projectId] as const,
};

/** Where Patch lives. Falls back to the variant's URL until (and unless) discovery answers. */
export function useAssistantEndpoint(projectId: string | undefined): string {
  const query = useQuery({
    queryKey: assistantKeys.endpoint(projectId ?? ''),
    queryFn: ({ signal }) => assistantService.endpoint(projectId as string, signal),
    enabled: !!projectId,
    staleTime: 60 * 60_000,
  });
  return query.data ?? env.assistantUrl;
}

/** The project's conversation history (active and archived). */
export function useConversations(projectId: string | undefined) {
  return useQuery({
    queryKey: assistantKeys.conversations(projectId ?? ''),
    queryFn: ({ signal }) => assistantService.list(projectId as string, signal),
    enabled: !!projectId,
  });
}

/**
 * Applies a change to the cached history straight away, runs it against the
 * server, and puts the old list back if the server refuses. Either way the
 * list is refetched afterwards to reconcile.
 */
function useOptimisticHistory<V>(
  projectId: string | undefined,
  update: (list: ChatSummary[], vars: V) => ChatSummary[],
  action: (projectId: string, vars: V) => Promise<unknown>
) {
  const queryClient = useQueryClient();
  const key = assistantKeys.conversations(projectId ?? '');
  return useMutation({
    mutationFn: (vars: V) => action(projectId as string, vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatSummary[]>(key);
      queryClient.setQueryData<ChatSummary[]>(key, (list) => update(list ?? [], vars));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

export function useSetChatArchived(projectId: string | undefined) {
  return useOptimisticHistory<{ chatId: string; archived: boolean }>(
    projectId,
    (list, { chatId, archived }) => list.map((c) => (c.id === chatId ? { ...c, archived } : c)),
    (project, { chatId, archived }) => assistantService.setArchived(project, chatId, archived)
  );
}

export function useDeleteChat(projectId: string | undefined) {
  return useOptimisticHistory<{ chatId: string }>(
    projectId,
    (list, { chatId }) => list.filter((c) => c.id !== chatId),
    (project, { chatId }) => assistantService.remove(project, chatId)
  );
}

/** Rename goes to the service (it's a write the read-only apiserver doesn't take). */
export function useRenameChat(
  projectId: string | undefined,
  rename: (input: { contextId: string; projectName: string; name: string }) => Promise<unknown>
) {
  return useOptimisticHistory<{ chatId: string; name: string }>(
    projectId,
    (list, { chatId, name }) => list.map((c) => (c.id === chatId ? { ...c, title: name.trim() } : c)),
    (project, { chatId, name }) => rename({ contextId: chatId, projectName: project, name })
  );
}
