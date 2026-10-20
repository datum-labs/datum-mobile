import { Button, Spinner, Text, useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Notice } from '@/components/Notice';
import { useProjectId } from '@/context/ProjectContext';
import { describeError } from '@/api/errors';
import { useInstance } from '@/resources/compute/queries';
import { createBridgeConnector } from '@/resources/console/bridge';
import {
  DEFAULT_SHELL_COMMAND,
  OPENING_STATUS,
  parseCommand,
  QUICK_COMMANDS,
  ShellSession,
  shellStatusPill,
  type ShellState,
} from '@/resources/console/control-plane';
import { hasWebView } from '@/resources/console/native-support';
import { endedNotice } from '@/resources/console/presenters';
import type { AccessoryKey, TerminalTheme } from '@/resources/console/protocol';
import { consoleService } from '@/resources/console/service';

import { ShellKeyBar } from './ShellKeyBar';
import { ShellTerminal, useTerminalBridge } from './ShellTerminal';
import { useToolbarIcon } from '@/lib/icons/toolbar';
import { StatusLabel } from '@/components/Grouped';

/** Route params: `command` picks the shell; `devRun`/`devKeyboard` are DEV ONLY (headless runs). */
export type InstanceShellParams = {
  instance: string;
  command?: string;
  /** DEV ONLY: typed into the shell once it connects (one line per `;;`). */
  devRun?: string;
  /** DEV ONLY: `1` focuses the terminal once connected, so the keyboard shows. */
  devKeyboard?: string;
};

/**
 * DEV ONLY: `devRun` scripts already typed in this JS session. On
 * `globalThis` so a Fast Refresh, which re-runs this module, doesn't type
 * them again (as Patch's `devSend`).
 */
const devRunsDone: Set<string> = ((globalThis as { __datumDevShellRuns?: Set<string> }).__datumDevShellRuns ??=
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

function useTerminalTheme(): TerminalTheme {
  const t = useDatumTheme();
  return useMemo(() => {
    const dark = t.scheme === 'dark';
    return {
      scheme: dark ? 'dark' : 'light',
      background: dark ? t.palette.midnightFjord : t.colors.background,
      foreground: dark ? t.palette.glacierMist700 : t.colors.foreground,
      cursor: dark ? t.palette.auroraMoss : t.palette.midnightFjord,
      selection: withAlpha(dark ? t.palette.auroraMoss : t.palette.midnightFjord, dark ? 0.3 : 0.2),
      fontFamily: t.fonts.mono,
      fontSize: 13,
    };
  }, [t]);
}

function ShellTitle({ name, state }: { name: string; state?: ShellState }) {
  const pill = state ? shellStatusPill(state) : undefined;
  return (
    <View style={styles.title} accessibilityRole="header">
      <Text weight="semibold" numberOfLines={1} style={styles.titleText}>
        {name}
      </Text>
      {pill ? <StatusLabel status={pill.status} label={pill.label} /> : null}
    </View>
  );
}

function Unavailable({ title, description }: { title: string; description: string }) {
  const t = useDatumTheme();
  const headerHeight = useHeaderHeight();
  return (
    <View style={[styles.centered, { paddingTop: headerHeight + 24, backgroundColor: t.colors.background }]}>
      <Notice kind="info" icon="terminal" title={title} description={description} />
    </View>
  );
}

/**
 * A shell in a running instance, full screen over the tabs: the terminal
 * page in a WebView, a key row above the keyboard, and the session's state
 * in the header. Closing it (or leaving) deletes the session.
 */
export function InstanceShellScreen() {
  const toolbarIcon = useToolbarIcon();
  const params = useLocalSearchParams<InstanceShellParams>();
  const name = params.instance;
  const projectId = useProjectId();
  const instanceQuery = useInstance(projectId, name);
  const instance = instanceQuery.data;
  const webViewAvailable = hasWebView();

  // No pill until there's a session to describe.
  const header = (state?: ShellState, menu: ReactNode = null) => (
    <>
      <Stack.Screen options={{ headerTitle: () => <ShellTitle name={name ?? 'Shell'} state={state} /> }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon={toolbarIcon('xmark')} accessibilityLabel="Close" onPress={() => router.back()} />
      </Stack.Toolbar>
      {menu}
    </>
  );

  if (!webViewAvailable) {
    return (
      <>
        {header()}
        <Unavailable
          title="Update the app to use the shell"
          description="This build of Datum doesn't include the terminal. Install the latest version to open a shell in an instance."
        />
      </>
    );
  }
  if (!instance) {
    return (
      <>
        {header()}
        {instanceQuery.error ? (
          <Unavailable title="Couldn't load the instance" description={describeError(instanceQuery.error)} />
        ) : null}
      </>
    );
  }
  if (instance.status !== 'Available' || instance.containers.length === 0) {
    return (
      <>
        {header()}
        <Unavailable
          title="This instance isn't running"
          description="A shell can be opened once the instance is running."
        />
      </>
    );
  }
  return (
    <ShellSessionView
      projectId={projectId as string}
      instanceName={instance.name}
      instanceUid={instance.uid}
      containers={instance.containers}
      initialCommand={params.command || DEFAULT_SHELL_COMMAND}
      devRun={__DEV__ ? params.devRun : undefined}
      devKeyboard={__DEV__ && params.devKeyboard === '1'}
      header={header}
    />
  );
}

function ShellSessionView({
  projectId,
  instanceName,
  instanceUid,
  containers,
  initialCommand,
  devRun,
  devKeyboard,
  header,
}: {
  projectId: string;
  instanceName: string;
  instanceUid: string;
  containers: string[];
  initialCommand: string;
  devRun?: string;
  devKeyboard: boolean;
  header(state?: ShellState, menu?: ReactNode): ReactNode;
}) {
  const toolbarIcon = useToolbarIcon();
  const t = useDatumTheme();
  const theme = useTerminalTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const keyboardShown = useKeyboardShown();
  const bridge = useTerminalBridge();
  const { port } = bridge;

  const [state, setState] = useState<ShellState>({ phase: 'idle' });
  const [reachedShell, setReachedShell] = useState(false);
  const [command, setCommand] = useState(initialCommand);
  const [container, setContainer] = useState(containers[0]);
  const [ctrl, setCtrl] = useState(false);
  const sessionRef = useRef<ShellSession | null>(null);

  useEffect(() => {
    const session = new ShellSession(
      consoleService.sessionDeps(projectId, () => createBridgeConnector(port)),
      {
        instanceName,
        instanceUid,
        onState: (next) => {
          if (next.phase === 'connected') {
            setReachedShell(true);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          }
          if (next.phase === 'ended') setCtrl(false);
          setState(next);
        },
        onOutput: () => undefined,
      }
    );
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [projectId, instanceName, instanceUid, port]);

  // The page reports Ctrl consumed, and keeps its own size.
  useEffect(
    () =>
      port.subscribe((message) => {
        if (message.type === 'ctrl') setCtrl(message.on);
      }),
    [port]
  );

  useEffect(() => {
    port.send({ type: 'setTheme', theme });
  }, [port, theme]);

  const open = useCallback(
    (nextCommand: string, nextContainer: string) => {
      const argv = parseCommand(nextCommand);
      if (!argv.ok || !sessionRef.current) return;
      setCommand(nextCommand);
      setContainer(nextContainer);
      setReachedShell(false);
      setCtrl(false);
      port.send({ type: 'ctrl', on: false });
      port.send({ type: 'reset' });
      // The page sizes the stream from its terminal; this is only a fallback.
      void sessionRef.current.open(nextContainer, argv.argv, () => ({ cols: 80, rows: 24 }));
    },
    [port]
  );

  // Open the shell as soon as the screen appears.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open(initialCommand, containers[0]);
  }, [open, initialCommand, containers]);

  // DEV ONLY: type `devRun` once per launch after connecting; focus for the keyboard.
  useEffect(() => {
    if (!__DEV__ || state.phase !== 'connected') return;
    if (devKeyboard) setTimeout(() => port.send({ type: 'focus' }), 300);
    if (!devRun || devRunsDone.has(devRun)) return;
    devRunsDone.add(devRun);
    const lines = devRun.split(';;');
    lines.forEach((line, i) => {
      setTimeout(() => sessionRef.current?.write(`${line}\n`), 800 + i * 900);
    });
  }, [state.phase, devRun, devKeyboard, port]);

  const live = state.phase === 'connecting' || state.phase === 'connected';
  const sendKey = (key: AccessoryKey) => {
    // Keys go to whichever session the page is running; arrows depend on its cursor mode.
    if (live) port.send({ type: 'key', key });
  };

  const menu = (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon={toolbarIcon('bolt')} accessibilityLabel="Quick commands" title="Open a new shell">
        <Stack.Toolbar.Menu inline title="Command">
          {QUICK_COMMANDS.map((quick) => (
            <Stack.Toolbar.MenuAction
              key={quick}
              icon={toolbarIcon('terminal')}
              isOn={quick === command}
              onPress={() => open(quick, container)}>
              {quick}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        {containers.length > 1 ? (
          <Stack.Toolbar.Menu inline title="Container">
            {containers.map((c) => (
              <Stack.Toolbar.MenuAction key={c} isOn={c === container} onPress={() => open(command, c)}>
                {c}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        ) : null}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );

  const ended = state.phase === 'ended' ? endedNotice(state, reachedShell) : undefined;
  const opening =
    state.phase === 'starting' || state.phase === 'waiting' || state.phase === 'connecting'
      ? OPENING_STATUS[state.phase]
      : undefined;

  return (
    <>
      {header(state, menu)}
      <View
        style={[
          styles.root,
          {
            backgroundColor: theme.background,
            paddingTop: headerHeight,
            // Landscape: keep the terminal and keys clear of the Dynamic Island side.
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}>
        <KeyboardAvoidingView behavior="padding" style={styles.root}>
          <View style={styles.root}>
            <ShellTerminal bridge={bridge} theme={theme} />
            {opening ? (
              <View pointerEvents="none" style={styles.overlay}>
                <Spinner size="small" />
                <Text size="sm" style={{ color: withAlpha(theme.foreground, 0.7) }}>
                  {opening}
                </Text>
              </View>
            ) : null}
            {ended && !reachedShell ? (
              <View style={[styles.overlay, styles.endedOverlay, { backgroundColor: theme.background }]}>
                <EndedNotice notice={ended} onReconnect={() => open(command, container)} />
              </View>
            ) : null}
          </View>
          {ended && reachedShell ? (
            <View style={[styles.endedBar, { paddingBottom: keyboardShown ? 8 : insets.bottom + 8 }]}>
              <EndedNotice notice={ended} onReconnect={() => open(command, container)} />
            </View>
          ) : null}
          {live ? (
            <View style={{ paddingBottom: keyboardShown ? 0 : insets.bottom, backgroundColor: t.colors.background }}>
              <ShellKeyBar
                ctrl={ctrl}
                keyboardShown={keyboardShown}
                onKey={sendKey}
                onText={(text) => sessionRef.current?.write(text)}
                onCtrl={() => {
                  const next = !ctrl;
                  setCtrl(next);
                  port.send({ type: 'ctrl', on: next });
                }}
                onToggleKeyboard={() => port.send({ type: keyboardShown ? 'blur' : 'focus' })}
              />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

function EndedNotice({
  notice,
  onReconnect,
}: {
  notice: ReturnType<typeof endedNotice>;
  onReconnect(): void;
}) {
  return (
    <Notice
      kind={notice.kind}
      icon={notice.kind === 'info' ? 'terminal' : undefined}
      title={notice.title}
      description={notice.description}
      action={
        notice.canReconnect ? (
          <Button type="secondary" theme="outline" size="small" onPress={onReconnect}>
            Reconnect
          </Button>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 260 },
  titleText: { flexShrink: 1 },
  centered: { flex: 1, paddingHorizontal: 16 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  endedOverlay: { paddingHorizontal: 16, alignItems: 'stretch' },
  endedBar: { paddingHorizontal: 12, paddingTop: 8 },
});
