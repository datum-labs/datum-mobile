import type { ConsoleEnding, ShellConnector } from '../../../src/resources/console/control-plane';
import type { FromTerminal, TerminalTheme } from '../../../src/resources/console/protocol';
import { createTerminalController, type TerminalSurface } from '../src/controller';
import { keySequence, withCtrl } from '../src/keys';

const KEY = 'ef'.repeat(32);
const target = { uid: 'u', endpointID: 'ab'.repeat(32), relayURLs: ['https://relay'], target: 'agent:7777' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeConnector(key = KEY) {
  const written: string[] = [];
  const resized: unknown[] = [];
  let disposed = 0;
  let output: ((b: Uint8Array) => void) | undefined;
  let end: ((e: ConsoleEnding) => void) | undefined;
  let connected: (() => void) | undefined;
  let connectedWith: unknown;
  const connector: ShellConnector = {
    load: async () => key,
    connect(t, size, onOutput, onEnd, onConnected) {
      connectedWith = { t, size };
      output = onOutput;
      end = onEnd;
      connected = onConnected;
    },
    write: (d) => {
      written.push(d);
    },
    resize: (s) => {
      resized.push(s);
    },
    dispose: () => {
      disposed++;
    },
  };
  return {
    connector,
    written,
    resized,
    get disposed() {
      return disposed;
    },
    get connectedWith() {
      return connectedWith;
    },
    output: (b: Uint8Array) => output?.(b),
    end: (e: Partial<ConsoleEnding>) => end?.({ exitCode: 0, reason: '', message: '', error: '', ...e }),
    connected: () => connected?.(),
  };
}

function harness(connectors = [fakeConnector()]) {
  const posted: FromTerminal[] = [];
  const written: (Uint8Array | string)[] = [];
  const calls: string[] = [];
  let clock = 0;
  let applicationCursor = false;
  const queue = [...connectors];
  const terminal: TerminalSurface = {
    cols: 100,
    rows: 30,
    get applicationCursor() {
      return applicationCursor;
    },
    write: (d) => {
      written.push(d);
    },
    reset: () => calls.push('reset'),
    focus: () => calls.push('focus'),
    blur: () => calls.push('blur'),
    fit: () => calls.push('fit'),
    setTheme: (t: TerminalTheme) => calls.push(`theme:${t.scheme}`),
  };
  const controller = createTerminalController({
    terminal,
    createConnector: () => {
      const next = queue.shift();
      if (!next) throw new Error('no connector');
      return next.connector;
    },
    post: (m) => posted.push(m),
    now: () => clock,
  });
  return {
    controller,
    posted,
    written,
    calls,
    tick: (ms: number) => {
      clock += ms;
    },
    setApplicationCursor: (on: boolean) => {
      applicationCursor = on;
    },
  };
}

describe('keys', () => {
  test('sends Esc, Tab and arrows in the mode the program chose', () => {
    expect(keySequence('esc', false)).toBe('\x1b');
    expect(keySequence('tab', false)).toBe('\t');
    expect(keySequence('up', false)).toBe('\x1b[A');
    expect(keySequence('left', false)).toBe('\x1b[D');
    expect(keySequence('up', true)).toBe('\x1bOA');
    expect(keySequence('right', true)).toBe('\x1bOC');
  });

  test('turns Ctrl plus a key into its control character', () => {
    expect(withCtrl('c')).toBe('\x03');
    expect(withCtrl('C')).toBe('\x03');
    expect(withCtrl('d')).toBe('\x04');
    expect(withCtrl('[')).toBe('\x1b');
    expect(withCtrl(' ')).toBe('\x00');
    expect(withCtrl('?')).toBe('\x7f');
    expect(withCtrl('é')).toBeUndefined();
    expect(withCtrl('ab')).toBeUndefined();
  });
});

describe('terminal controller', () => {
  test('starts a client per sid and reports its key', async () => {
    const h = harness();
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    await settle();
    expect(h.posted).toEqual([{ type: 'publicKey', sid: 1, key: KEY }]);
  });

  test("drops a key that arrives after a newer session's request", async () => {
    const first = fakeConnector('aa'.repeat(32));
    const second = fakeConnector();
    const h = harness([first, second]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    h.controller.receive({ type: 'getPublicKey', sid: 2 });
    await settle();

    expect(first.disposed).toBe(1);
    expect(h.posted).toEqual([{ type: 'publicKey', sid: 2, key: KEY }]);
  });

  test('connects at the terminal size and writes output to the terminal', async () => {
    const c = fakeConnector();
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    await settle();
    h.controller.receive({ type: 'connect', sid: 1, target });

    expect(c.connectedWith).toEqual({ t: target, size: { cols: 100, rows: 30 } });
    c.connected();
    c.output(new Uint8Array([36, 32]));
    h.tick(100);
    c.output(new Uint8Array([33]));
    h.tick(600);
    c.output(new Uint8Array([10]));

    expect(h.written).toHaveLength(3);
    expect(h.posted.slice(1)).toEqual([
      { type: 'connected', sid: 1 },
      { type: 'output-activity', sid: 1 },
      { type: 'output-activity', sid: 1 },
    ]);
  });

  test('ignores a connect for another sid', async () => {
    const c = fakeConnector();
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    h.controller.receive({ type: 'connect', sid: 2, target });
    expect(c.connectedWith).toBeUndefined();
  });

  test('forwards typing only while a stream is open', async () => {
    const c = fakeConnector();
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    h.controller.onData('early');
    await settle();
    h.controller.receive({ type: 'connect', sid: 1, target });
    h.controller.onData('ls\r');
    h.controller.receive({ type: 'input', sid: 1, data: '|' });
    h.controller.receive({ type: 'input', sid: 9, data: 'stale' });
    c.end({ exitCode: 0 });
    h.controller.onData('late');

    expect(c.written).toEqual(['ls\r', '|']);
    expect(h.posted.at(-1)).toEqual({
      type: 'ended',
      sid: 1,
      ending: { exitCode: 0, reason: '', message: '', error: '' },
    });
  });

  test('applies a sticky Ctrl to the next key and reports it released', async () => {
    const c = fakeConnector();
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    await settle();
    h.controller.receive({ type: 'connect', sid: 1, target });
    h.controller.receive({ type: 'ctrl', on: true });
    h.controller.onData('c');
    h.controller.onData('c');

    expect(c.written).toEqual(['\x03', 'c']);
    expect(h.posted.at(-1)).toEqual({ type: 'ctrl', on: false });
  });

  test('sends accessory keys in the cursor mode the program set', async () => {
    const c = fakeConnector();
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    await settle();
    h.controller.receive({ type: 'connect', sid: 1, target });
    h.controller.receive({ type: 'key', key: 'up' });
    h.setApplicationCursor(true);
    h.controller.receive({ type: 'key', key: 'up' });
    h.controller.receive({ type: 'key', key: 'esc' });

    expect(c.written).toEqual(['\x1b[A', '\x1bOA', '\x1b']);
  });

  test('passes resizes to the stream and tells the app the size', async () => {
    const c = fakeConnector();
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    await settle();
    h.controller.receive({ type: 'connect', sid: 1, target });
    h.controller.onResize({ cols: 60, rows: 20 });

    expect(c.resized).toEqual([{ cols: 60, rows: 20 }]);
    expect(h.posted.at(-1)).toEqual({ type: 'size', cols: 60, rows: 20 });
  });

  test('end closes only its own session', async () => {
    const c = fakeConnector();
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 1 });
    await settle();
    h.controller.receive({ type: 'end', sid: 2 });
    expect(c.disposed).toBe(0);
    h.controller.receive({ type: 'end', sid: 1 });
    expect(c.disposed).toBe(1);
  });

  test('reports a client that cannot start', async () => {
    const c = fakeConnector();
    c.connector.load = () => Promise.reject(new Error("The shell client isn't part of this build."));
    const h = harness([c]);
    h.controller.receive({ type: 'getPublicKey', sid: 4 });
    await settle();
    expect(h.posted).toEqual([{ type: 'error', sid: 4, message: "The shell client isn't part of this build." }]);
  });

  test('applies theme, focus, blur, reset and resize to the terminal', () => {
    const h = harness();
    h.controller.receive({
      type: 'setTheme',
      theme: {
        scheme: 'light',
        background: '#fff',
        foreground: '#000',
        cursor: '#000',
        selection: '#ccc',
        fontFamily: 'Menlo',
        fontSize: 13,
      },
    });
    h.controller.receive({ type: 'focus' });
    h.controller.receive({ type: 'blur' });
    h.controller.receive({ type: 'reset' });
    h.controller.receive({ type: 'resize' });
    expect(h.calls).toEqual(['theme:light', 'focus', 'blur', 'reset', 'fit']);
  });
});
