import {
  ConversationRow,
  Text,
  useDatumTheme,
  type ChatSummary,
} from '@datum-cloud/datum-ui-native';
import { MAX_CONVERSATION_NAME_LENGTH } from '@datum-cloud/datum-ui-assistant-core';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { describeError } from '@/api/errors';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Segmented } from '@/components/Segmented';
import { NoProjectState, RowSkeletons } from '@/components/states';
import { useProjectContext } from '@/context/ProjectContext';
import { announceChatRemoved, requestOpenChat } from '@/lib/assistant-bus';
import {
  useAssistantEndpoint,
  useConversations,
  useDeleteChat,
  useRenameChat,
  useSetChatArchived,
} from '@/resources/assistant/queries';
import { displayTitle } from '@/resources/assistant/config';
import { createChatTransport } from '@/resources/assistant/service';

type HistoryView = 'recent' | 'archived';

const VIEWS = [
  { value: 'recent', label: 'Recent' },
  { value: 'archived', label: 'Archived' },
] as const;

function SwipeAction({
  label,
  symbol,
  color,
  onPress,
}: {
  label: string;
  symbol: string;
  color: string;
  onPress: () => void;
}) {
  const t = useDatumTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: pressed ? t.colors.border : t.colors.muted }]}>
      <Icon name={symbol as never} size={18} color={color} />
      <Text size="xs" weight="medium">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Patch's conversation history for the current project: recent and archived
 * chats, swipe to archive or delete (delete asks first), long-press for
 * rename. Tapping a chat hands it back to the chat screen that opened this.
 */
export function ConversationHistoryScreen() {
  const t = useDatumTheme();
  const { from, current } = useLocalSearchParams<{ from?: string; current?: string }>();
  const { selection, hydrated } = useProjectContext();
  const projectId = selection?.projectId;
  const query = useConversations(projectId);
  const baseUrl = useAssistantEndpoint(projectId);
  const transport = useMemo(() => createChatTransport(baseUrl), [baseUrl]);
  const archive = useSetChatArchived(projectId);
  const remove = useDeleteChat(projectId);
  const rename = useRenameChat(projectId, transport.rename);
  const [view, setView] = useState<HistoryView>('recent');
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  const chats = useMemo(
    () => (query.data ?? []).filter((c) => Boolean(c.archived) === (view === 'archived')),
    [query.data, view]
  );

  const fail = (message: string) => (error: unknown) => setActionError(`${message} ${describeError(error)}`);

  const open = (chat: ChatSummary) => {
    if (from && requestOpenChat(from, chat.id)) {
      router.back();
      return;
    }
    router.replace({ pathname: '/assistant', params: { chat: chat.id } } as Href);
  };

  const setArchived = (chat: ChatSummary, archived: boolean) => {
    setActionError(undefined);
    if (archived) announceChatRemoved(chat.id);
    archive.mutate(
      { chatId: chat.id, archived },
      { onError: fail(archived ? "Couldn't archive that chat." : "Couldn't restore that chat.") }
    );
  };

  const confirmDelete = (chat: ChatSummary) => {
    Alert.alert('Delete chat?', `“${chat.title}” will be permanently deleted. This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setActionError(undefined);
          announceChatRemoved(chat.id);
          remove.mutate({ chatId: chat.id }, { onError: fail("Couldn't delete that chat.") });
        },
      },
    ]);
  };

  const promptRename = (chat: ChatSummary) => {
    Alert.prompt(
      'Rename chat',
      `Up to ${MAX_CONVERSATION_NAME_LENGTH} characters.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rename',
          isPreferred: true,
          onPress: (value?: string) => {
            const name = (value ?? '').trim();
            if (!name || name === chat.title) return;
            if ([...name].length > MAX_CONVERSATION_NAME_LENGTH) {
              setActionError(`Names can be at most ${MAX_CONVERSATION_NAME_LENGTH} characters.`);
              return;
            }
            setActionError(undefined);
            rename.mutate({ chatId: chat.id, name }, { onError: fail("Couldn't rename that chat.") });
          },
        },
      ],
      'plain-text',
      chat.title
    );
  };

  const showMenu = (chat: ChatSummary) => {
    const archived = Boolean(chat.archived);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: chat.title,
        options: ['Rename', archived ? 'Restore' : 'Archive', 'Delete', 'Cancel'],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 3,
      },
      (index) => {
        if (index === 0) promptRename(chat);
        else if (index === 1) setArchived(chat, !archived);
        else if (index === 2) confirmDelete(chat);
      }
    );
  };

  const header = <Stack.Screen options={{ title: 'History' }} />;

  if (!projectId) {
    return (
      <>
        {header}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
          {hydrated ? <NoProjectState /> : null}
        </ScrollView>
      </>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.colors.background }}>
      {header}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.colors.mutedForeground}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await query.refetch();
              } finally {
                setRefreshing(false);
              }
            }}
          />
        }>
        <Segmented options={VIEWS} value={view} onChange={setView} />
        {actionError ? <Notice kind="error" title="That didn't work" description={actionError} /> : null}
        {query.data === undefined ? (
          query.error ? (
            <Notice kind="error" title="Couldn't load your chats" description={describeError(query.error)} />
          ) : (
            <RowSkeletons count={4} />
          )
        ) : chats.length === 0 ? (
          <Text tone="muted" style={styles.emptyText}>
            {view === 'archived' ? 'No archived chats.' : 'No chats yet. Ask Patch something to start one.'}
          </Text>
        ) : (
          <View style={[styles.group, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}>
            {chats.map((chat, i) => (
              <ReanimatedSwipeable
                key={chat.id}
                friction={2}
                rightThreshold={40}
                overshootRight={false}
                renderRightActions={(_progress, _translation, methods) => (
                  <View style={styles.actions}>
                    <SwipeAction
                      label={chat.archived ? 'Restore' : 'Archive'}
                      symbol={chat.archived ? 'tray.and.arrow.up' : 'archivebox'}
                      color={t.colors.foreground}
                      onPress={() => {
                        methods.close();
                        setArchived(chat, !chat.archived);
                      }}
                    />
                    <SwipeAction
                      label="Delete"
                      symbol="trash"
                      color={t.colors.destructive}
                      onPress={() => {
                        methods.close();
                        confirmDelete(chat);
                      }}
                    />
                  </View>
                )}
>
                <ConversationRow
                  chat={{ ...chat, title: displayTitle(chat.title) }}
                  active={chat.id === current}
                  onPress={() => open(chat)}
                  onLongPress={() => showMenu(chat)}
                  trailing={<Icon name="chevron.right" size={13} color={t.colors.mutedForeground} />}
                  testID={`conversation-${chat.id}`}
                />
                {i < chats.length - 1 ? (
                  <View style={[styles.separator, { backgroundColor: t.colors.border }]} />
                ) : null}
              </ReanimatedSwipeable>
            ))}
          </View>
        )}
        {chats.length > 0 ? (
          <Text size="xs" tone="muted" style={styles.hint}>
            Swipe a chat to archive or delete it. Touch and hold to rename.
          </Text>
        ) : null}
      </ScrollView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  group: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  actions: { flexDirection: 'row' },
  action: { width: 76, alignItems: 'center', justifyContent: 'center', gap: 4 },
  emptyText: { textAlign: 'center', marginTop: 32 },
  hint: { textAlign: 'center' },
});
