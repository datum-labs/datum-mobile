import {
  A2ARpcError,
  AssistantHttpError,
  type AssistantStreamEvent,
  type SendStreamingInput,
} from '@datum-cloud/datum-ui-assistant-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { describeAssistantError, useAssistantChat } from '../useAssistantChat';

type Script = (input: SendStreamingInput) => AsyncGenerator<AssistantStreamEvent>;

const mockChat = {
  script: (async function* () {})() as unknown as Script,
  sent: [] as SendStreamingInput[],
  cancel: jest.fn(async () => true),
};

jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `uuid-${++n}` };
});

jest.mock('@/resources/assistant/service', () => ({
  createChatTransport: () => ({
    sendStreaming: (input: SendStreamingInput) => {
      mockChat.sent.push(input);
      return mockChat.script(input);
    },
    cancel: mockChat.cancel,
  }),
  assistantService: {
    messages: jest.fn(async () => [{ id: 'seq-1', role: 'user', parts: [{ type: 'text', text: 'Old question', state: 'done' }] }]),
  },
}));

jest.mock('@/resources/assistant/queries', () => ({
  assistantKeys: { conversations: (p: string) => ['assistant', 'conversations', p] },
  useAssistantEndpoint: () => 'https://patch.example',
  useConversations: () => ({ data: [] }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockChat.sent = [];
  mockChat.cancel.mockClear();
});

describe('useAssistantChat', () => {
  it('streams a turn into the transcript and settles ready', async () => {
    mockChat.script = async function* () {
      yield { type: 'tool_start', id: 't1', name: 'alb__alb_list' };
      yield { type: 'tool_finish', id: 't1', name: 'alb__alb_list', ok: true, elapsedMs: 9 };
      yield { type: 'text_delta', text: 'All ' };
      yield { type: 'text_delta', text: 'good.' };
      yield { type: 'done', state: 'completed', text: 'All good.' };
    };
    const { result } = await renderHook(() => useAssistantChat('demo'), { wrapper });
    await act(async () => result.current.send('Is it healthy?', { mentions: [{ kind: 'HTTPProxy', name: 'web' }] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(mockChat.sent[0]).toMatchObject({
      text: '@HTTPProxy/web Is it healthy?',
      projectName: 'demo',
      contextId: result.current.chatId,
      mentions: [{ kind: 'HTTPProxy', name: 'web' }],
    });
    const [prompt, answer] = result.current.messages;
    expect(prompt).toMatchObject({ role: 'user', parts: [{ type: 'text', text: '@HTTPProxy/web Is it healthy?' }] });
    expect(answer!.parts).toEqual([
      expect.objectContaining({ type: 'dynamic-tool', state: 'output-available' }),
      { type: 'text', text: 'All good.', state: 'done' },
    ]);
    expect(result.current.title).toBe('@HTTPProxy/web Is it healthy?');
  });

  it('shows a failed turn as an error and retries the same prompt', async () => {
    mockChat.script = async function* () {
      yield { type: 'done', state: 'failed', error: 'Agent run failed: boom' };
    };
    const { result } = await renderHook(() => useAssistantChat('demo'), { wrapper });
    await act(async () => result.current.send('Hi'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Something went wrong — Agent run failed: boom');

    mockChat.script = async function* () {
      yield { type: 'text_delta', text: 'Hello' };
      yield { type: 'done', state: 'completed' };
    };
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeUndefined();
    expect(mockChat.sent.map((s) => s.text)).toEqual(['Hi', 'Hi']);
    expect(result.current.messages).toHaveLength(2);
  });

  it('stops a turn: aborts the stream and cancels the task', async () => {
    let release: () => void = () => {};
    mockChat.script = async function* (input) {
      input.onTask?.({ taskId: 'task-9' });
      yield { type: 'text_delta', text: 'Partial' };
      await new Promise<void>((resolve) => {
        release = resolve;
        input.signal?.addEventListener('abort', () => resolve());
      });
      if (input.signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
    };
    const { result } = await renderHook(() => useAssistantChat('demo'), { wrapper });
    await act(async () => result.current.send('Long one'));
    await waitFor(() => expect(result.current.status).toBe('streaming'));
    await act(async () => result.current.stop());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockChat.cancel).toHaveBeenCalledWith('task-9');
    expect(result.current.error).toBeUndefined();
    release();
  });

  it('loads a stored conversation and starts new chats with a fresh id', async () => {
    const { result } = await renderHook(() => useAssistantChat('demo'), { wrapper });
    await act(async () => result.current.loadChat('conv-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.chatId).toBe('conv-1');
    expect(result.current.messages).toHaveLength(1);
    await act(async () => result.current.newChat());
    expect(result.current.chatId).not.toBe('conv-1');
    expect(result.current.messages).toEqual([]);
  });
});

describe('describeAssistantError', () => {
  it.each([
    [new AssistantHttpError(401, 'x (HTTP 401)'), 'Your session expired. Sign in again to keep chatting.'],
    [new AssistantHttpError(403, 'x (HTTP 403)'), "You don't have access to Patch in this project."],
    [new AssistantHttpError(500, 'x (HTTP 500)'), 'Patch is having trouble right now. Try again shortly.'],
    [new AssistantHttpError(503, 'not configured (HTTP 503)'), 'AI assistant is not configured.'],
    [new AssistantHttpError(429, 'slow down (HTTP 429)'), expect.stringContaining('rate limit')],
    [new A2ARpcError({ code: -32602, message: 'projectName is required' }), "Patch couldn't take that request: projectName is required"],
    [new TypeError('Network request failed'), "You're offline, or Patch can't be reached."],
    [new Error('Agent run failed: boom'), 'Something went wrong — Agent run failed: boom'],
  ])('%s', (error, copy) => {
    expect(describeAssistantError(error)).toEqual(copy);
  });
});
