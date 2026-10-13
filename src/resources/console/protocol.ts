/**
 * The bridge between the shell screen (React Native) and the terminal page
 * in its WebView (`native/console-web`, bundled to `assets/console/terminal.html`).
 *
 * The page owns the terminal (xterm.js) and the shell client (compute's
 * console WASM in a Web Worker), so output never crosses the bridge: the app
 * drives the session and the page reports what happened.
 *
 * Every session-bound message carries `sid`, the app's attempt number. Each
 * `getPublicKey` starts a fresh client in the page under a new `sid`, and both
 * sides drop messages for any other `sid`, so a late reply from a closed
 * session can't touch a new one. Types only plus small pure helpers, shared
 * by both sides and by the tests.
 */
import type { ConsoleEnding, ConsoleTarget } from './control-plane';

/** Keys the accessory row sends that depend on the terminal's modes. */
export type AccessoryKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right';

export interface TerminalTheme {
  scheme: 'light' | 'dark';
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  fontFamily: string;
  fontSize: number;
}

/** App → page. */
export type ToTerminal =
  | { type: 'getPublicKey'; sid: number }
  | { type: 'connect'; sid: number; target: ConsoleTarget }
  | { type: 'input'; sid: number; data: string }
  /** An accessory key for the page's current session. */
  | { type: 'key'; key: AccessoryKey }
  | { type: 'ctrl'; on: boolean }
  | { type: 'resize' }
  | { type: 'end'; sid: number }
  | { type: 'setTheme'; theme: TerminalTheme }
  | { type: 'focus' }
  | { type: 'blur' }
  | { type: 'reset' };

/** Page → app. */
export type FromTerminal =
  | { type: 'ready'; cols: number; rows: number }
  | { type: 'publicKey'; sid: number; key: string }
  | { type: 'connected'; sid: number }
  | { type: 'output-activity'; sid: number }
  | { type: 'ended'; sid: number; ending: ConsoleEnding }
  | { type: 'error'; sid?: number; message: string }
  | { type: 'ctrl'; on: boolean }
  | { type: 'size'; cols: number; rows: number }
  | { type: 'focus'; focused: boolean };

const FROM_TYPES = new Set<FromTerminal['type']>([
  'ready',
  'publicKey',
  'connected',
  'output-activity',
  'ended',
  'error',
  'ctrl',
  'size',
  'focus',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Parses a WebView message (`event.nativeEvent.data`). Anything that isn't a
 * well-formed page message is dropped, never thrown.
 */
export function parseFromTerminal(data: string): FromTerminal | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isObject(raw) || typeof raw.type !== 'string' || !FROM_TYPES.has(raw.type as FromTerminal['type'])) {
    return undefined;
  }
  const sid = raw.sid;
  switch (raw.type) {
    case 'ready':
    case 'size':
      return isNumber(raw.cols) && isNumber(raw.rows)
        ? { type: raw.type, cols: raw.cols, rows: raw.rows }
        : undefined;
    case 'publicKey':
      return isNumber(sid) && typeof raw.key === 'string' && /^[0-9a-f]{64}$/.test(raw.key)
        ? { type: 'publicKey', sid, key: raw.key }
        : undefined;
    case 'connected':
    case 'output-activity':
      return isNumber(sid) ? { type: raw.type, sid } : undefined;
    case 'ended': {
      const e = raw.ending;
      if (!isNumber(sid) || !isObject(e)) return undefined;
      return {
        type: 'ended',
        sid,
        ending: {
          exitCode: isNumber(e.exitCode) ? e.exitCode : 1,
          reason: typeof e.reason === 'string' ? e.reason : '',
          message: typeof e.message === 'string' ? e.message : '',
          error: typeof e.error === 'string' ? e.error : '',
        },
      };
    }
    case 'error':
      return typeof raw.message === 'string'
        ? isNumber(sid)
          ? { type: 'error', sid, message: raw.message }
          : { type: 'error', message: raw.message }
        : undefined;
    case 'ctrl':
      return typeof raw.on === 'boolean' ? { type: 'ctrl', on: raw.on } : undefined;
    case 'focus':
      return typeof raw.focused === 'boolean' ? { type: 'focus', focused: raw.focused } : undefined;
  }
  return undefined;
}

/** The global the page installs; the app calls it through `injectJavaScript`. */
export const PAGE_RECEIVER = '__datumConsole';

/** JavaScript that delivers one message to the page. */
export function injectionFor(message: ToTerminal): string {
  return `window.${PAGE_RECEIVER}&&window.${PAGE_RECEIVER}.receive(${JSON.stringify(message)});true;`;
}
