import {
  createAssistantTransport,
  deleteConversation,
  getAssistantEndpointUrl,
  getConversationMessages,
  listConversations,
  mergeChatSummaries,
  setConversationArchived,
  toUIMessages,
  type AssistantTransport,
  type ChatSummary,
  type FetchLike,
  type ScopedFetch,
  type UIMessage,
} from '@datum-cloud/datum-ui-assistant-core';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';

import { api, projectScopedBase } from '@/api';
import { session } from '@/auth/instance';
import { env } from '@/config/env';

/**
 * Patch's two halves:
 *
 * - History (list, transcript, archive, delete) is the aggregated apiserver,
 *   reached through the app's API client under the project's control plane.
 * - Chat is the service's A2A endpoint, called directly with the user's own
 *   access token. Not the apiserver's `sendmessage`: that path has no caller
 *   token, so tools would run without the user's identity.
 */

/** The API client's raw fetch, scoped to a project's control plane (what the shared helpers expect). */
export function projectFetch(projectId: string): ScopedFetch {
  const base = projectScopedBase(projectId);
  return (path, init) => api.fetch(`${base}${path}`, init);
}

export const assistantService = {
  /**
   * The service origin from the cluster's `AssistantEndpoint`, else the
   * variant's configured URL (an endpoint that isn't published, or a
   * control plane without the resource, isn't an error).
   */
  async endpoint(projectId: string, signal?: AbortSignal): Promise<string> {
    try {
      return (await getAssistantEndpointUrl(projectFetch(projectId), { signal })) ?? env.assistantUrl;
    } catch {
      return env.assistantUrl;
    }
  },

  /** Active and archived conversations, newest activity first. */
  async list(projectId: string, signal?: AbortSignal): Promise<ChatSummary[]> {
    const scoped = projectFetch(projectId);
    const [active, archived] = await Promise.all([
      listConversations(scoped, projectId, { signal }),
      listConversations(scoped, projectId, { archived: true, signal }),
    ]);
    return mergeChatSummaries(active, archived);
  },

  async messages(projectId: string, chatId: string, signal?: AbortSignal): Promise<UIMessage[]> {
    return toUIMessages(await getConversationMessages(projectFetch(projectId), projectId, chatId, { signal }));
  },

  async setArchived(projectId: string, chatId: string, archived: boolean): Promise<void> {
    await setConversationArchived(projectFetch(projectId), projectId, chatId, archived);
  },

  async remove(projectId: string, chatId: string): Promise<void> {
    await deleteConversation(projectFetch(projectId), projectId, chatId);
  },
};

/**
 * `expo/fetch` streams response bodies (React Native's built-in fetch
 * buffers them) and honours AbortController. Its Response is close enough to
 * the core's `FetchResponse` to pass straight through.
 */
const streamingFetch: FetchLike = (url, init) => expoFetch(url, init) as unknown as ReturnType<FetchLike>;

/** A chat transport for one service origin, authenticated with the session's access token. */
export function createChatTransport(baseUrl: string): AssistantTransport {
  return createAssistantTransport({
    baseUrl,
    fetch: streamingFetch,
    getToken: () => session.getAccessToken(),
    refreshToken: (rejected) => session.handleUnauthorized(rejected),
    newId: randomUUID,
  });
}
