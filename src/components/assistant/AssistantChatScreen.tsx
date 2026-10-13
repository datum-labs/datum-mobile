import {
  AssistantComposer,
  AssistantConfigProvider,
  AssistantEmptyState,
  AssistantThread,
  Text,
  useDatumTheme,
  type AssistantThreadHandle,
  type Mention,
  type NativeAssistantConfig,
  type UIMessage,
} from '@datum-cloud/datum-ui-native';
import { firstText, messageText } from '@datum-cloud/datum-ui-assistant-core';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { randomUUID } from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { NoProjectState } from '@/components/states';
import { env } from '@/config/env';
import { useProjectContext } from '@/context/ProjectContext';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { onChatRemoved, onOpenChat } from '@/lib/assistant-bus';
import {
  displayTitle,
  mentionNoun,
  mentionSuggestions,
  splitLeadingMentions,
  SUGGESTIONS,
  TOOL_LABELS,
} from '@/resources/assistant/config';
import { resolveAnswerLink } from '@/resources/assistant/links';
import { Button } from '@datum-cloud/datum-ui-native';

/** Route params: `chat` opens a stored conversation; `mention*` prefill a resource ("Ask Patch about this"). */
export type AssistantChatParams = {
  chat?: string;
  mentionKind?: string;
  mentionName?: string;
  mentionGroup?: string;
  /** Display name for the chip (e.g. an ALB's display name); defaults to the name. */
  mentionLabel?: string;
  /** DEV ONLY: send this prompt on open (headless simulator runs; see useDevRouteScript). */
  devSend?: string;
  /** A nonce: start a new chat, even when Patch is already open (the Ask Patch control). */
  new?: string;
};

/**
 * DEV ONLY: `devSend` prompts already sent in this JS session. On `globalThis`
 * so a Fast Refresh, which re-runs this module, doesn't send them again.
 */
const devPromptsSent: Set<string> = ((globalThis as { __datumDevPromptsSent?: Set<string> }).__datumDevPromptsSent ??=
  new Set<string>());

function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

const MENTION_SYMBOL: Record<string, string> = {
  HTTPProxy: 'network',
  Workload: 'shippingbox',
  Instance: 'cpu',
  Domain: 'globe',
  DNSZone: 'list.bullet.rectangle',
};

function MentionChip({ label, kind, onRemove }: { label: string; kind: string; onRemove?: () => void }) {
  const t = useDatumTheme();
  return (
    <View style={[styles.chip, { backgroundColor: t.colors.muted, borderColor: t.colors.border }]}>
      <Icon name={(MENTION_SYMBOL[kind] ?? 'cube') as never} size={13} color={t.colors.primary} />
      <Text size="xs" weight="medium" numberOfLines={1} style={styles.chipText}>
        {label}
      </Text>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Don't ask about ${label}`}
          hitSlop={10}
          onPress={onRemove}>
          <Icon name="xmark.circle.fill" size={14} color={t.colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Patch, the assistant: one conversation scoped to the current project, with
 * the header's close, history and new-chat actions. Presented full screen
 * from Home, and from "Ask Patch about this" with the resource as a mention.
 */
export function AssistantChatScreen() {
  const t = useDatumTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboardShown = useKeyboardShown();
  const params = useLocalSearchParams<AssistantChatParams>();
  const { selection, hydrated } = useProjectContext();
  const projectId = selection?.projectId;
  const { state } = useAuth();
  const firstName = state.status === 'signedIn' ? state.user.name?.split(/\s+/)[0] : undefined;

  const chat = useAssistantChat(projectId);
  const { loadChat, newChat, send, stop, retry } = chat;
  const [draft, setDraft] = useState('');
  const threadRef = useRef<AssistantThreadHandle>(null);
  const [instanceId] = useState(() => randomUUID());

  // The resource this chat was opened about, until the first prompt carries it.
  const paramMention = useMemo<(Mention & { label: string }) | undefined>(
    () =>
      params.mentionKind && params.mentionName
        ? {
            kind: params.mentionKind,
            name: params.mentionName,
            ...(params.mentionGroup ? { apiGroup: params.mentionGroup } : {}),
            label: params.mentionLabel || params.mentionName,
          }
        : undefined,
    [params.mentionKind, params.mentionName, params.mentionGroup, params.mentionLabel]
  );
  const [mention, setMention] = useState(paramMention);
  // A new "Ask Patch about this" (new params) replaces the chip; set during
  // render rather than in an effect so the first frame already shows it.
  const [mentionSource, setMentionSource] = useState(paramMention);
  if (paramMention !== mentionSource) {
    setMentionSource(paramMention);
    setMention(paramMention);
  }

  useEffect(() => {
    if (params.chat) void loadChat(params.chat);
  }, [params.chat, loadChat]);

  // Each new nonce is a fresh "Ask Patch" from Control Centre or the Action button.
  useEffect(() => {
    if (params.new && !params.chat) newChat();
  }, [params.new, params.chat, newChat]);

  // The history screen hands a picked chat back to the screen that opened it.
  useEffect(() => onOpenChat(instanceId, (id) => void loadChat(id)), [instanceId, loadChat]);
  useEffect(
    () =>
      onChatRemoved((id) => {
        if (id === chat.chatId) newChat();
      }),
    [chat.chatId, newChat]
  );

  const submit = useCallback(
    (text: string) => {
      send(text, mention ? { mentions: [{ kind: mention.kind, name: mention.name, apiGroup: mention.apiGroup }] } : {});
      setDraft('');
      setMention(undefined);
    },
    [send, mention]
  );

  // DEV ONLY: lets a route script drive a real turn without taps. Tracked
  // per launch, not per mount, so a Fast Refresh doesn't send it again.
  const devSend = __DEV__ ? params.devSend : undefined;
  useEffect(() => {
    if (!__DEV__ || !devSend || !projectId || devPromptsSent.has(devSend)) return;
    const timer = setTimeout(() => {
      if (devPromptsSent.has(devSend)) return;
      devPromptsSent.add(devSend);
      submit(devSend);
    }, 0);
    return () => clearTimeout(timer);
  }, [devSend, projectId, submit]);

  const onLinkPress = useCallback(
    (href: string) => {
      const link = resolveAnswerLink(href, { projectId, portalUrl: env.portalUrl });
      if (link.kind === 'route') {
        // Patch is a modal over the tabs: close it (from wherever its own
        // stack is), then open the screen in the tab underneath.
        if (router.canDismiss()) router.dismissAll();
        router.back();
        setTimeout(() => router.push(link.href as Href), 0);
      } else void WebBrowser.openBrowserAsync(link.url).catch(() => undefined);
    },
    [projectId]
  );

  const config = useMemo<Partial<NativeAssistantConfig>>(
    () => ({
      greeting: (name?: string) => (mention ? `What would you like to know?` : `Hey there${name ? `, ${name}` : ''}`),
      suggestions: mention ? mentionSuggestions(mention) : SUGGESTIONS,
      toolLabels: TOOL_LABELS,
      // A2A carries no reasoning parts, so there's nothing to show.
      showReasoning: false,
      onLinkPress,
    }),
    [mention, onLinkPress]
  );

  // Prompts carry their mentions as literal `@Kind/name` tokens; show them as chips.
  const formatUserMessage = useCallback((msg: UIMessage) => {
    const { mentions, text } = splitLeadingMentions(firstText(msg));
    if (mentions.length === 0) return { text };
    return {
      text,
      accessory: (
        <View style={styles.chips}>
          {mentions.map((m) => (
            <MentionChip key={`${m.kind}/${m.name}`} label={m.name} kind={m.kind} />
          ))}
        </View>
      ),
    };
  }, []);

  const onShare = useCallback((msg: UIMessage) => {
    void Share.share({ message: messageText(msg) }).catch(() => undefined);
  }, []);

  const startNewChat = useCallback(() => {
    newChat();
    setDraft('');
    setMention(undefined);
  }, [newChat]);

  const empty = chat.messages.length === 0 && chat.status !== 'submitted';
  const title = empty ? 'Patch' : displayTitle(chat.title);
  const header = (
    <>
      <Stack.Screen options={{ title }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="clock.arrow.circlepath"
          accessibilityLabel="Chat history"
          disabled={!projectId}
          onPress={() =>
            router.push({ pathname: '/assistant/history', params: { from: instanceId, current: chat.chatId } } as Href)
          }
        />
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          accessibilityLabel="New chat"
          disabled={!projectId || (empty && !mention)}
          onPress={startNewChat}
        />
      </Stack.Toolbar>
    </>
  );

  if (!projectId) {
    return (
      <>
        {header}
        <View style={[styles.noProject, { backgroundColor: t.colors.background, paddingTop: insets.top + 96 }]}>
          {hydrated ? <NoProjectState /> : null}
        </View>
      </>
    );
  }

  const footer = chat.error ? (
    <View style={styles.notice}>
      <Notice
        kind="error"
        title="Patch couldn't answer"
        description={chat.error}
        action={
          <Button type="secondary" theme="outline" size="small" onPress={retry}>
            Try again
          </Button>
        }
      />
    </View>
  ) : chat.recovering ? (
    <View style={styles.notice}>
      <Notice kind="info" title="Reconnecting" description="The connection dropped. Waiting for Patch to finish…" />
    </View>
  ) : null;

  return (
    <AssistantConfigProvider config={config}>
      {header}
      <KeyboardAvoidingView behavior="padding" style={[styles.root, { backgroundColor: t.colors.background }]}>
        <AssistantThread
          ref={threadRef}
          messages={chat.messages}
          status={chat.status}
          onShare={onShare}
          formatUserMessage={formatUserMessage}
          footer={footer}
          // Pad for the transparent header ourselves: with automatic insets,
          // "scroll to the end" of a short thread would tuck it under the bar.
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[{ paddingTop: headerHeight + 12 }, empty ? styles.emptyContent : null]}
          ListEmptyComponent={
            chat.status === 'submitted' ? null : (
              <AssistantEmptyState
                name={firstName}
                onSuggestion={submit}
                disabled={chat.busy}>
                {mention ? (
                  <Text tone="muted" style={styles.about}>
                    About the {mentionNoun(mention)} <Text weight="medium">{mention.label}</Text>
                  </Text>
                ) : null}
              </AssistantEmptyState>
            )
          }
        />
        <View style={[styles.composer, { paddingBottom: keyboardShown ? 8 : insets.bottom + 8 }]}>
          <AssistantComposer
            value={draft}
            onChangeText={setDraft}
            onSend={submit}
            onStop={stop}
            busy={chat.status === 'streaming'}
            disabled={chat.status === 'submitted'}
            placeholder={mention ? `Ask about ${mention.label}…` : undefined}
            accessory={
              mention ? (
                <MentionChip label={mention.label} kind={mention.kind} onRemove={() => setMention(undefined)} />
              ) : null
            }
            testID="assistant-composer"
          />
        </View>
      </KeyboardAvoidingView>
    </AssistantConfigProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  emptyContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: 24 },
  composer: { paddingHorizontal: 12, paddingTop: 6 },
  notice: { marginTop: 16 },
  noProject: { flex: 1, paddingHorizontal: 16 },
  about: { textAlign: 'center', marginTop: -16, marginBottom: 20 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 4,
    maxWidth: '100%',
  },
  chipText: { flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
