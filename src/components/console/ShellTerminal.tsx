import { useCallback, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import type { TerminalPort } from '@/resources/console/bridge';
import { hasWebView } from '@/resources/console/native-support';
import {
  injectionFor,
  parseFromTerminal,
  type FromTerminal,
  type TerminalTheme,
  type ToTerminal,
} from '@/resources/console/protocol';

/** Where the build puts the page (plugins/with-console-assets.js), relative to the app bundle. */
// iOS: bundle-relative file URL; Android: the APK's assets (plugins/with-console-assets).
const PAGE = Platform.OS === 'android' ? 'file:///android_asset/console/terminal.html' : 'console/terminal.html';
const PAGE_DIR = Platform.OS === 'android' ? 'file:///android_asset/console/' : 'console';

export const TERMINAL_STOPPED = 'The terminal stopped. Reconnect to open a new shell.';
export const CLIENT_MISSING = "The shell client isn't part of this build.";

interface WebViewHandle {
  injectJavaScript(script: string): void;
  reload(): void;
}

interface WebViewProps {
  ref?: RefObject<WebViewHandle | null>;
  source: { uri: string };
  style?: StyleProp<ViewStyle>;
  [prop: string]: unknown;
}

/**
 * react-native-webview's component, or null in a binary without it.
 * Required only after checking: the package looks its native module up when
 * imported, which throws where it isn't linked.
 */
const WebView: ComponentType<WebViewProps> | null = hasWebView()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('react-native-webview') as { WebView: ComponentType<WebViewProps> }).WebView
  : null;

export interface TerminalBridge {
  port: TerminalPort;
  webRef: RefObject<WebViewHandle | null>;
  onMessage(data: string): void;
  /** The page is gone (crash or failed load): fail the session. */
  onLost(message: string): void;
  /** The page's process was killed: reload it (at most once a minute; else on the next send). */
  onCrashed(): void;
}

/**
 * The app's end of the terminal bridge. Messages sent before the page says
 * `ready` wait in a queue; the page's messages fan out to subscribers (the
 * session's connector and the screen).
 */
export function useTerminalBridge(): TerminalBridge {
  const webRef = useRef<WebViewHandle | null>(null);
  const bridge = useRef({
    ready: false,
    queue: [] as ToTerminal[],
    listeners: new Set<(message: FromTerminal) => void>(),
    /** When the page last reloaded itself after its process was killed. */
    lastCrashReload: 0,
    /** The page is dead and waits for the next message (Reconnect) to reload. */
    reloadOnSend: false,
  });

  const port = useMemo<TerminalPort>(
    () => ({
      send(message) {
        const b = bridge.current;
        if (b.ready && webRef.current) webRef.current.injectJavaScript(injectionFor(message));
        else b.queue.push(message);
        if (b.reloadOnSend) {
          b.reloadOnSend = false;
          webRef.current?.reload();
        }
      },
      subscribe(listener) {
        bridge.current.listeners.add(listener);
        return () => {
          bridge.current.listeners.delete(listener);
        };
      },
    }),
    []
  );

  const emit = useCallback((message: FromTerminal) => {
    for (const listener of [...bridge.current.listeners]) listener(message);
  }, []);

  const onMessage = useCallback(
    (data: string) => {
      const message = parseFromTerminal(data);
      if (!message) return;
      const b = bridge.current;
      if (message.type === 'ready') {
        b.ready = true;
        const queued = b.queue.splice(0);
        for (const m of queued) webRef.current?.injectJavaScript(injectionFor(m));
      }
      emit(message);
    },
    [emit]
  );

  const onLost = useCallback(
    (message: string) => {
      bridge.current.ready = false;
      bridge.current.queue = [];
      emit({ type: 'error', message });
    },
    [emit]
  );

  /**
   * WebKit killed the page's process (usually memory: it holds a 17 MB wasm).
   * Reload it once so Reconnect works; if it dies again within a minute,
   * reloading straight away would just recompile the wasm and die again, so
   * wait until the user asks to reconnect.
   */
  const onCrashed = useCallback(() => {
    const b = bridge.current;
    const now = Date.now();
    if (now - b.lastCrashReload < CRASH_RELOAD_WINDOW_MS) {
      b.reloadOnSend = true;
      return;
    }
    b.lastCrashReload = now;
    webRef.current?.reload();
  }, []);

  return { port, webRef, onMessage, onLost, onCrashed };
}

const CRASH_RELOAD_WINDOW_MS = 60_000;

/**
 * The terminal page in a WebView, loaded from the app bundle. The theme is
 * set before the page's first paint so it never flashes white.
 */
export function ShellTerminal({
  bridge,
  theme,
  style,
}: {
  bridge: TerminalBridge;
  theme: TerminalTheme;
  style?: StyleProp<ViewStyle>;
}) {
  const { webRef, onMessage, onLost, onCrashed } = bridge;
  // The initial theme only; later changes go over the bridge (setTheme).
  const [initialTheme] = useState(theme);
  const beforeLoad = useMemo(
    () => `window.__DATUM_CONSOLE_THEME__=${JSON.stringify(initialTheme)};true;`,
    [initialTheme]
  );

  if (!WebView) return null;
  return (
    <WebView
      ref={webRef}
      source={{ uri: PAGE }}
      allowingReadAccessToURL={PAGE_DIR}
      originWhitelist={['file://*']}
      onShouldStartLoadWithRequest={(request: { url: string }) =>
        request.url.startsWith('file:') || request.url.startsWith('about:')
      }
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      injectedJavaScriptBeforeContentLoaded={beforeLoad}
      onMessage={(event: { nativeEvent: { data: string } }) => onMessage(event.nativeEvent.data)}
      onContentProcessDidTerminate={() => {
        onLost(TERMINAL_STOPPED);
        onCrashed();
      }}
      onError={() => onLost(CLIENT_MISSING)}
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      dataDetectorTypes={["none"]}
      allowsLinkPreview={false}
      autoManageStatusBarEnabled={false}
      webviewDebuggingEnabled={__DEV__}
      style={[styles.web, { backgroundColor: theme.background }, style]}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1 },
});
