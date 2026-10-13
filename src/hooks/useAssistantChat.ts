import {
  A2ARpcError,
  applyAssistantEvent,
  assistantErrorMessage,
  AssistantHttpError,
  deriveTitle,
  firstText,
  isAbortError,
  NEW_CHAT_TITLE,
  turnOutcome,
  type AssistantStreamEvent,
  type AssistantTransport,
  type Mention,
  type UIMessage,
} from '@datum-cloud/datum-ui-assistant-core';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { withMentionText } from '@/resources/assistant/config';
import { assistantKeys, useAssistantEndpoint, useConversations } from '@/resources/assistant/queries';
import { assistantService, createChatTransport } from '@/resources/assistant/service';

/** `submitted` while a stored transcript loads; `streaming` while a reply arrives. */
export type AssistantStatus = 'ready' | 'submitted' | 'streaming' | 'error';

/** User-facing copy for anything a turn or a transcript load can throw. */
export function describeAssistantError(error: unknown): string {
  if (error instanceof AssistantHttpError) {
    if (error.status === 401) return 'Your session expired. Sign in again to keep chatting.';
    if (error.status === 403) return "You don't have access to Patch in this project.";
    if (error.status === 404) return "That conversation doesn't exist any more.";
    if (error.status >= 500 && error.status !== 503) return 'Patch is having trouble right now. Try again shortly.';
  }
  if (error instanceof A2ARpcError) return `Patch couldn't take that request: ${error.message}`;
  if (error instanceof Error) {
    if (/network request failed|failed to fetch|network connection/i.test(error.message))
      return "You're offline, or Patch can't be reached.";
    return assistantErrorMessage(error);
  }
  return 'Something went wrong.';
}

export interface SendOptions {
  mentions?: Mention[];
}

interface Turn {
  text: string;
  mentions?: Mention[];
}

/**
 * The state of one Patch conversation, driven by the shared core transport
 * over A2A: messages (as `UIMessage`s, built by the core reducer), status,
 * error, and the actions the chat screen needs. History lives in react-query
 * (`useConversations`); this hook refreshes it whenever a turn settles,
 * because a turn creates, titles or unarchives its conversation.
 */
export function useAssistantChat(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const baseUrl = useAssistantEndpoint(projectId);
  const transport = useMemo<AssistantTransport>(() => createChatTransport(baseUrl), [baseUrl]);
  const conversations = useConversations(projectId);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  /** The transcript as of the last update, for callbacks that run between renders. */
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [status, setStatusState] = useState<AssistantStatus>('ready');
  const statusRef = useRef(status);
  /** Status goes to a ref as well as state: a second send in the same frame must see it. */
  const setStatus = useCallback((next: AssistantStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const [error, setError] = useState<string | undefined>();
  const [recovering, setRecovering] = useState(false);
  const [chatId, setChatId] = useState<string>(() => randomUUID());
  const chatIdRef = useRef(chatId);

  const abortRef = useRef<AbortController | null>(null);
  const taskIdRef = useRef<string | undefined>(undefined);
  const lastTurnRef = useRef<Turn | null>(null);
  const failedLoadRef = useRef<string | null>(null);
  /** Bumped on every chat switch; a stale stream or load drops its updates. */
  const sessionRef = useRef(0);

  const refreshHistory = useCallback(() => {
    if (projectId) void queryClient.invalidateQueries({ queryKey: assistantKeys.conversations(projectId) });
  }, [queryClient, projectId]);

  const runTurn = useCallback(
    async (turn: Turn, base?: UIMessage[]) => {
      if (!projectId || statusRef.current === 'streaming' || statusRef.current === 'submitted') return;
      const prompt = turn.text.trim();
      if (!prompt) return;
      const text = withMentionText(prompt, turn.mentions ?? []);
      const session = sessionRef.current;
      const isCurrent = () => session === sessionRef.current;

      lastTurnRef.current = turn;
      failedLoadRef.current = null;
      setError(undefined);
      const assistantId = randomUUID();
      const prior = base ?? messagesRef.current;
      const next: UIMessage[] = [
        ...prior,
        { id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] },
        { id: assistantId, role: 'assistant', parts: [] },
      ];
      messagesRef.current = next;
      setMessages(next);
      setStatus('streaming');

      const controller = new AbortController();
      abortRef.current = controller;
      taskIdRef.current = undefined;

      // Coalesce a burst of stream events into one render per frame.
      let pending: AssistantStreamEvent[] = [];
      let frame: number | null = null;
      const flush = () => {
        frame = null;
        if (!isCurrent() || pending.length === 0) return;
        const events = pending;
        pending = [];
        setMessages((prev) => {
          let out = prev;
          for (const event of events) out = applyAssistantEvent(out, event, { messageId: assistantId, newId: randomUUID });
          messagesRef.current = out;
          return out;
        });
      };
      const enqueue = (event: AssistantStreamEvent) => {
        pending.push(event);
        if (frame === null) frame = requestAnimationFrame(flush);
      };

      try {
        for await (const event of transport.sendStreaming({
          text,
          contextId: chatIdRef.current,
          projectName: projectId,
          mentions: turn.mentions,
          signal: controller.signal,
          onTask: ({ taskId }) => {
            taskIdRef.current = taskId;
          },
          onRecovering: () => {
            if (isCurrent()) setRecovering(true);
          },
        })) {
          enqueue(event);
          if (event.type === 'done') {
            if (frame !== null) cancelAnimationFrame(frame);
            flush();
            if (!isCurrent()) break;
            const outcome = turnOutcome(event);
            if (outcome.error) setError(describeAssistantError(outcome.error));
            setStatus(outcome.status);
          }
        }
        // A stream that ended without `done` (only possible when aborted) settles here.
        // (Read through a function: TS narrowed the ref at the guard above.)
        const statusNow = (): AssistantStatus => statusRef.current;
        if (isCurrent() && statusNow() === 'streaming') setStatus('ready');
      } catch (err) {
        if (frame !== null) cancelAnimationFrame(frame);
        flush();
        if (isCurrent()) {
          if (controller.signal.aborted || isAbortError(err)) {
            // Stopped by the user: settle the reply as it stands.
            setMessages((prev) => applyAssistantEvent(prev, { type: 'done', state: 'canceled' }, { messageId: assistantId }));
            setStatus('ready');
          } else {
            setMessages((prev) => applyAssistantEvent(prev, { type: 'done', state: 'failed' }, { messageId: assistantId }));
            setError(describeAssistantError(err));
            setStatus('error');
          }
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (isCurrent()) setRecovering(false);
        refreshHistory();
      }
    },
    [projectId, transport, refreshHistory, setStatus]
  );

  const send = useCallback(
    (text: string, options: SendOptions = {}) => void runTurn({ text, mentions: options.mentions }),
    [runTurn]
  );

  /** Stops the reply: aborts the stream and asks the service to cancel the task. */
  const stop = useCallback(() => {
    const taskId = taskIdRef.current;
    abortRef.current?.abort();
    if (taskId) void transport.cancel(taskId).catch(() => undefined);
  }, [transport]);

  const switchTo = useCallback((id: string) => {
    sessionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    taskIdRef.current = undefined;
    failedLoadRef.current = null;
    lastTurnRef.current = null;
    chatIdRef.current = id;
    setChatId(id);
    messagesRef.current = [];
    setMessages([]);
    setError(undefined);
    setRecovering(false);
  }, []);

  const newChat = useCallback(() => {
    switchTo(randomUUID());
    setStatus('ready');
  }, [switchTo, setStatus]);

  const loadChat = useCallback(
    async (id: string) => {
      if (!projectId) return;
      if (id === chatIdRef.current && statusRef.current === 'streaming') return;
      switchTo(id);
      const session = sessionRef.current;
      setStatus('submitted');
      try {
        const loaded = await assistantService.messages(projectId, id);
        if (session !== sessionRef.current) return;
        messagesRef.current = loaded;
        setMessages(loaded);
        setStatus('ready');
      } catch (err) {
        if (session !== sessionRef.current) return;
        failedLoadRef.current = id;
        setError(describeAssistantError(err));
        setStatus('error');
      }
    },
    [projectId, switchTo, setStatus]
  );

  /** Retries the failed transcript load, or re-sends the last prompt. */
  const retry = useCallback(() => {
    const failedLoad = failedLoadRef.current;
    if (failedLoad && failedLoad === chatIdRef.current) {
      void loadChat(failedLoad);
      return;
    }
    const msgs = messagesRef.current;
    const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
    if (lastUser === -1) return;
    const turn = lastTurnRef.current ?? { text: firstText(msgs[lastUser]!) };
    const truncated = msgs.slice(0, lastUser);
    setError(undefined);
    // The retried prompt gets its mention token back from `withMentionText`.
    void runTurn(turn, truncated);
  }, [loadChat, runTurn]);

  // Conversations are project-scoped: a project switch starts a new chat.
  const firstProject = useRef(true);
  useEffect(() => {
    if (firstProject.current) {
      firstProject.current = false;
      return;
    }
    newChat();
  }, [projectId, newChat]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const chatList = conversations.data;
  const title = useMemo(() => {
    const server = chatList?.find((c) => c.id === chatId)?.title;
    if (server && server !== NEW_CHAT_TITLE) return server;
    return messages.length > 0 ? deriveTitle(messages) : NEW_CHAT_TITLE;
  }, [chatList, chatId, messages]);

  return {
    chatId,
    title,
    messages,
    status,
    error,
    recovering,
    /** True while a reply streams or a transcript loads. */
    busy: status === 'streaming' || status === 'submitted',
    canRetry: status === 'error',
    transport,
    send,
    stop,
    retry,
    newChat,
    loadChat,
  };
}
