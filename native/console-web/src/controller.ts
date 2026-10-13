/**
 * The terminal page's message handling, kept free of xterm and the DOM so
 * jest can drive it. The app sends `ToTerminal` messages (protocol.ts); this
 * runs one shell client per `sid`, writes its output to the terminal and
 * reports back with `FromTerminal` messages.
 */
import type {
  ConsoleEnding,
  ShellConnector,
  TerminalSize,
} from '../../../src/resources/console/control-plane';
import type { FromTerminal, TerminalTheme, ToTerminal } from '../../../src/resources/console/protocol';
import { keySequence, withCtrl } from './keys';

/** The xterm surface the controller uses. */
export interface TerminalSurface {
  readonly cols: number;
  readonly rows: number;
  /** DECCKM, which xterm exposes as `modes.applicationCursorKeysMode`. */
  readonly applicationCursor: boolean;
  write(data: Uint8Array | string): void;
  reset(): void;
  focus(): void;
  blur(): void;
  fit(): void;
  setTheme(theme: TerminalTheme): void;
}

export interface ControllerOptions {
  terminal: TerminalSurface;
  createConnector(): ShellConnector;
  post(message: FromTerminal): void;
  /** Minimum gap between `output-activity` messages. */
  activityIntervalMs?: number;
  now?: () => number;
}

export interface TerminalController {
  receive(message: ToTerminal): void;
  /** Keystrokes from the terminal (xterm `onData`). */
  onData(data: string): void;
  /** The terminal's new size (xterm `onResize`). */
  onResize(size: TerminalSize): void;
  /** Ends any session, for page unload. */
  dispose(): void;
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The shell client could not start.';
}

export function createTerminalController({
  terminal,
  createConnector,
  post,
  activityIntervalMs = 500,
  now = () => Date.now(),
}: ControllerOptions): TerminalController {
  let sid: number | undefined;
  let connector: ShellConnector | undefined;
  let streaming = false;
  let ctrl = false;
  let lastActivity = -Infinity;

  const release = () => {
    connector?.dispose();
    connector = undefined;
    streaming = false;
  };

  const send = (data: string) => {
    if (streaming) connector?.write(data);
  };

  const applyCtrl = (data: string): string => {
    if (!ctrl) return data;
    ctrl = false;
    post({ type: 'ctrl', on: false });
    return withCtrl(data) ?? data;
  };

  return {
    receive(message) {
      switch (message.type) {
        case 'getPublicKey': {
          release();
          sid = message.sid;
          const own = message.sid;
          try {
            connector = createConnector();
          } catch (err) {
            post({ type: 'error', sid: own, message: errorText(err) });
            return;
          }
          connector.load().then(
            (key) => {
              if (sid === own) post({ type: 'publicKey', sid: own, key });
            },
            (err: unknown) => {
              if (sid === own) post({ type: 'error', sid: own, message: errorText(err) });
            }
          );
          return;
        }
        case 'connect': {
          if (message.sid !== sid || !connector) return;
          const own = message.sid;
          streaming = true;
          terminal.fit();
          connector.connect(
            message.target,
            { cols: terminal.cols, rows: terminal.rows },
            (bytes) => {
              if (sid !== own) return;
              terminal.write(bytes);
              const t = now();
              if (t - lastActivity >= activityIntervalMs) {
                lastActivity = t;
                post({ type: 'output-activity', sid: own });
              }
            },
            (ending: ConsoleEnding) => {
              if (sid !== own) return;
              streaming = false;
              post({ type: 'ended', sid: own, ending });
            },
            () => {
              if (sid === own) post({ type: 'connected', sid: own });
            }
          );
          return;
        }
        case 'input':
          if (message.sid === sid) send(applyCtrl(message.data));
          return;
        case 'key':
          send(keySequence(message.key, terminal.applicationCursor));
          return;
        case 'ctrl':
          ctrl = message.on;
          return;
        case 'resize':
          terminal.fit();
          return;
        case 'end':
          if (message.sid === sid) {
            release();
            sid = undefined;
          }
          return;
        case 'setTheme':
          terminal.setTheme(message.theme);
          return;
        case 'focus':
          terminal.focus();
          return;
        case 'blur':
          terminal.blur();
          return;
        case 'reset':
          terminal.reset();
          return;
      }
    },
    onData(data) {
      send(applyCtrl(data));
    },
    onResize(size) {
      if (streaming) connector?.resize(size);
      post({ type: 'size', cols: size.cols, rows: size.rows });
    },
    dispose() {
      release();
      sid = undefined;
    },
  };
}
