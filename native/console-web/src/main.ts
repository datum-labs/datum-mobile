/**
 * The shell's terminal page. The app loads it from its bundle
 * (`console/terminal.html`, built by scripts/build-console-web.mjs) in a
 * WebView and drives it over the bridge in protocol.ts.
 *
 * xterm.js renders the terminal; compute's console WASM runs in a Web Worker,
 * as in the portal (`instance-shell.tsx`). The module is read once from the
 * bundle with XHR (WebKit's fetch can't read file URLs), compiled, and posted
 * to each session's worker.
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';

import { PAGE_RECEIVER, type FromTerminal, type TerminalTheme } from '../../../src/resources/console/protocol';
import { createWorkerConnector, type ConsoleWasm, type ShellWorker } from './connector';
import { createTerminalController } from './controller';

declare const __WORKER_SOURCE__: string;

interface NativeWindow {
  ReactNativeWebView?: { postMessage(data: string): void };
  __DATUM_CONSOLE_THEME__?: TerminalTheme;
  [PAGE_RECEIVER]?: { receive(message: unknown): void };
}

const win = window as unknown as NativeWindow;
const WASM_FILE = 'console-session.wasm';

function post(message: FromTerminal) {
  win.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

// ANSI colours that stay readable on the light background; the dark scheme
// keeps xterm's defaults, which suit the navy.
const LIGHT_ANSI: ITheme = {
  black: '#1f2328',
  red: '#cf222e',
  green: '#116329',
  yellow: '#7d4e00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
};

const FALLBACK_THEME: TerminalTheme = {
  scheme: 'dark',
  background: '#0c1d31',
  foreground: '#f6f6f5',
  cursor: '#e6f59f',
  selection: 'rgba(230,245,159,0.3)',
  fontFamily: 'Menlo',
  fontSize: 13,
};

function xtermTheme(theme: TerminalTheme): ITheme {
  return {
    ...(theme.scheme === 'light' ? LIGHT_ANSI : {}),
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.background,
    selectionBackground: theme.selection,
  };
}

function paint(theme: TerminalTheme) {
  document.documentElement.style.background = theme.background;
  document.body.style.background = theme.background;
}

// The compiled module, shared by every session's worker.
let wasm: Promise<ConsoleWasm> | undefined;

function readBundled(file: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', file);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      // File URLs report status 0.
      if ((xhr.status === 0 || xhr.status === 200) && xhr.response instanceof ArrayBuffer && xhr.response.byteLength) {
        resolve(xhr.response);
      } else {
        reject(new Error('The shell client is not part of this build.'));
      }
    };
    xhr.onerror = () => reject(new Error('The shell client is not part of this build.'));
    xhr.send();
  });
}

function loadWasm(): Promise<ConsoleWasm> {
  wasm ??= readBundled(WASM_FILE).then(async (bytes) => ({ module: await WebAssembly.compile(bytes), bytes }));
  wasm.catch(() => {
    wasm = undefined;
  });
  return wasm;
}

let workerUrl: string | undefined;

function spawnWorker(): ShellWorker {
  workerUrl ??= URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: 'text/javascript' }));
  return new Worker(workerUrl, { name: 'instance-shell' }) as unknown as ShellWorker;
}

function start() {
  let theme = win.__DATUM_CONSOLE_THEME__ ?? FALLBACK_THEME;
  paint(theme);

  const host = document.getElementById('terminal') as HTMLElement;
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: `${theme.fontFamily}, ui-monospace, monospace`,
    fontSize: theme.fontSize,
    scrollback: 5000,
    theme: xtermTheme(theme),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();

  const controller = createTerminalController({
    terminal: {
      get cols() {
        return term.cols;
      },
      get rows() {
        return term.rows;
      },
      get applicationCursor() {
        return term.modes.applicationCursorKeysMode;
      },
      write: (data) => term.write(data),
      reset: () => term.reset(),
      focus: () => term.focus(),
      blur: () => term.blur(),
      fit: () => fit.fit(),
      setTheme: (next) => {
        theme = next;
        paint(next);
        term.options.theme = xtermTheme(next);
        term.options.fontFamily = `${next.fontFamily}, ui-monospace, monospace`;
        term.options.fontSize = next.fontSize;
        fit.fit();
      },
    },
    createConnector: () => createWorkerConnector(loadWasm, spawnWorker),
    post,
  });

  win[PAGE_RECEIVER] = {
    receive: (message) => controller.receive(message as Parameters<typeof controller.receive>[0]),
  };
  term.onData((data) => controller.onData(data));
  term.onResize((size) => controller.onResize(size));
  term.textarea?.addEventListener('focus', () => post({ type: 'focus', focused: true }));
  term.textarea?.addEventListener('blur', () => post({ type: 'focus', focused: false }));
  // Android keyboards (Gboard) commit and compose text in xterm's hidden
  // textarea; xterm's own handling sends input and then re-sends leftovers on
  // Enter, doubling characters ("ls /" ran as "ls //"). On Android the page
  // takes text input over: each change to the textarea goes to the shell as a
  // diff (backspaces for anything rewritten), and the textarea is emptied once
  // nothing is being composed. Real keys (Enter, arrows, ...) still reach xterm.
  if (/Android/i.test(navigator.userAgent) && term.textarea) {
    const textarea = term.textarea;
    let sent = '';
    const send = (data: string) => {
      if (data) controller.onData(data);
    };
    const flush = () => {
      const value = textarea.value;
      let common = 0;
      while (common < sent.length && common < value.length && sent[common] === value[common]) common++;
      send('\x7f'.repeat(sent.length - common) + value.slice(common));
      sent = value;
    };
    const reset = () => {
      textarea.value = '';
      sent = '';
    };
    const swallow = (e: Event) => e.stopImmediatePropagation();
    textarea.addEventListener('compositionstart', swallow, true);
    textarea.addEventListener('compositionupdate', swallow, true);
    textarea.addEventListener(
      'compositionend',
      (e) => {
        swallow(e);
        flush();
        reset();
      },
      true
    );
    // Key 229 is "the IME is handling this"; xterm would start its own composition.
    textarea.addEventListener('keydown', (e) => e.keyCode === 229 && swallow(e), true);
    textarea.addEventListener(
      'input',
      (e) => {
        swallow(e);
        const input = e as InputEvent;
        if (input.inputType === 'insertLineBreak') {
          reset();
          send('\r');
          return;
        }
        if (input.inputType === 'deleteContentBackward' && sent === '' && textarea.value === '') {
          send('\x7f');
          return;
        }
        flush();
        if (!input.isComposing) reset();
      },
      true
    );
  }

  const refit = () => {
    fit.fit();
    term.scrollToBottom();
  };
  new ResizeObserver(refit).observe(host);
  window.visualViewport?.addEventListener('resize', refit);
  window.addEventListener('pagehide', () => controller.dispose());

  // Start compiling while the session is created.
  void loadWasm().catch(() => undefined);
  post({ type: 'ready', cols: term.cols, rows: term.rows });
}

try {
  start();
} catch (err) {
  // Without a terminal no session can run; the app shows this and offers to retry.
  post({ type: 'error', message: err instanceof Error ? err.message : 'The terminal could not start.' });
}
