import { createBridgeConnector, LOAD_TIMEOUT_MS, type TerminalPort } from '../bridge';
import type { ConsoleEnding } from '../control-plane';
import { endedNotice } from '../presenters';
import { injectionFor, parseFromTerminal, type FromTerminal, type ToTerminal } from '../protocol';

const KEY = 'ef'.repeat(32);
const target = { uid: 'u', endpointID: 'ab'.repeat(32), relayURLs: ['https://relay.example'], target: 'agent:7777' };

function fakePort() {
  const sent: ToTerminal[] = [];
  const listeners = new Set<(m: FromTerminal) => void>();
  const port: TerminalPort = {
    send: (m) => sent.push(m),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const page = (m: FromTerminal) => [...listeners].forEach((l) => l(m));
  return { port, sent, page, listeners };
}

describe('parseFromTerminal', () => {
  test('accepts each well-formed page message', () => {
    expect(parseFromTerminal('{"type":"ready","cols":80,"rows":24}')).toEqual({ type: 'ready', cols: 80, rows: 24 });
    expect(parseFromTerminal(JSON.stringify({ type: 'publicKey', sid: 3, key: KEY }))).toEqual({
      type: 'publicKey',
      sid: 3,
      key: KEY,
    });
    expect(parseFromTerminal('{"type":"connected","sid":3}')).toEqual({ type: 'connected', sid: 3 });
    expect(parseFromTerminal('{"type":"output-activity","sid":3}')).toEqual({ type: 'output-activity', sid: 3 });
    expect(parseFromTerminal('{"type":"ctrl","on":false}')).toEqual({ type: 'ctrl', on: false });
    expect(parseFromTerminal('{"type":"error","message":"boom"}')).toEqual({ type: 'error', message: 'boom' });
    expect(parseFromTerminal('{"type":"error","sid":2,"message":"boom"}')).toEqual({
      type: 'error',
      sid: 2,
      message: 'boom',
    });
  });

  test('fills in a partial ending the way the WASM adapter does', () => {
    expect(parseFromTerminal('{"type":"ended","sid":1,"ending":{"reason":"Expired"}}')).toEqual({
      type: 'ended',
      sid: 1,
      ending: { exitCode: 1, reason: 'Expired', message: '', error: '' },
    });
  });

  test('drops anything else', () => {
    for (const data of [
      'not json',
      '42',
      '{"type":"mystery"}',
      '{"type":"publicKey","sid":1,"key":"short"}',
      '{"type":"connected"}',
      '{"type":"ready","cols":"80","rows":24}',
      '{"type":"ended","sid":1}',
    ]) {
      expect(parseFromTerminal(data)).toBeUndefined();
    }
  });
});

describe('injectionFor', () => {
  test('calls the page receiver with the message as a JS literal', () => {
    const js = injectionFor({ type: 'input', sid: 1, data: "it's \"quoted\"\n</script>" });
    const received: unknown[] = [];
    const window = { __datumConsole: { receive: (m: unknown) => received.push(m) } };
    new Function('window', js)(window);
    expect(received).toEqual([{ type: 'input', sid: 1, data: "it's \"quoted\"\n</script>" }]);
  });

  test('is harmless before the page has installed its receiver', () => {
    expect(() => new Function('window', injectionFor({ type: 'resize' }))({})).not.toThrow();
  });
});

describe('createBridgeConnector', () => {
  test('asks the page for a key under its own sid', async () => {
    const { port, sent, page } = fakePort();
    const connector = createBridgeConnector(port, 7);
    const key = connector.load();
    expect(sent).toEqual([{ type: 'getPublicKey', sid: 7 }]);

    page({ type: 'publicKey', sid: 6, key: 'aa'.repeat(32) });
    page({ type: 'publicKey', sid: 7, key: KEY });
    await expect(key).resolves.toBe(KEY);
  });

  test('rejects the load when the page reports an error for it', async () => {
    const { port, page } = fakePort();
    const connector = createBridgeConnector(port, 1);
    const key = connector.load();
    page({ type: 'error', sid: 1, message: "The shell client isn't part of this build." });
    await expect(key).rejects.toThrow("The shell client isn't part of this build.");
  });

  test('gives up on a page that never answers', async () => {
    jest.useFakeTimers();
    try {
      const { port } = fakePort();
      const key = createBridgeConnector(port, 1).load();
      jest.advanceTimersByTime(LOAD_TIMEOUT_MS);
      await expect(key).rejects.toThrow(/too long/);
    } finally {
      jest.useRealTimers();
    }
  });

  test('connects, then reports connection, activity and the ending once', () => {
    const { port, sent, page } = fakePort();
    const connector = createBridgeConnector(port, 2);
    const events: string[] = [];
    const endings: ConsoleEnding[] = [];
    connector.connect(
      target,
      { cols: 80, rows: 24 },
      () => events.push('output'),
      (e) => endings.push(e),
      () => events.push('connected')
    );
    expect(sent).toEqual([{ type: 'connect', sid: 2, target }]);

    page({ type: 'connected', sid: 2 });
    page({ type: 'output-activity', sid: 2 });
    page({ type: 'output-activity', sid: 9 });
    const ending = { exitCode: 0, reason: '', message: '', error: '' };
    page({ type: 'ended', sid: 2, ending });
    page({ type: 'ended', sid: 2, ending });
    expect(events).toEqual(['connected', 'output']);
    expect(endings).toEqual([ending]);
  });

  test('ends the stream when the page itself is lost', () => {
    const { port, page } = fakePort();
    const connector = createBridgeConnector(port, 3);
    const endings: ConsoleEnding[] = [];
    connector.connect(target, { cols: 80, rows: 24 }, () => undefined, (e) => endings.push(e), () => undefined);
    page({ type: 'error', message: 'The terminal stopped.' });
    expect(endings).toEqual([{ exitCode: 1, reason: '', message: '', error: 'The terminal stopped.' }]);
  });

  test('sends input under its sid, and dispose ends the page session and stops listening', () => {
    const { port, sent, page, listeners } = fakePort();
    const connector = createBridgeConnector(port, 4);
    const endings: ConsoleEnding[] = [];
    connector.connect(target, { cols: 80, rows: 24 }, () => undefined, (e) => endings.push(e), () => undefined);
    connector.write('ls\r');
    connector.resize({ cols: 100, rows: 30 });
    connector.dispose();
    connector.dispose();

    expect(sent.slice(1)).toEqual([
      { type: 'input', sid: 4, data: 'ls\r' },
      { type: 'resize' },
      { type: 'end', sid: 4 },
    ]);
    expect(listeners.size).toBe(0);
    page({ type: 'ended', sid: 4, ending: { exitCode: 0, reason: '', message: '', error: 'closed' } });
    expect(endings).toEqual([]);
  });
});

describe('endedNotice', () => {
  test('is calm after a normal exit and offers Reconnect', () => {
    expect(endedNotice({ phase: 'ended', message: 'The shell exited.', reason: 'Completed' }, true)).toEqual({
      kind: 'info',
      title: 'Shell ended',
      description: 'The shell exited.',
      canReconnect: true,
    });
  });

  test('warns when the platform ended it or it never opened', () => {
    expect(endedNotice({ phase: 'ended', message: 'x', reason: 'Expired' }, true).kind).toBe('warning');
    expect(endedNotice({ phase: 'ended', message: 'x', reason: 'NotConnected' }, false)).toMatchObject({
      kind: 'warning',
      title: "Couldn't open the shell",
      canReconnect: true,
    });
  });

  test("doesn't offer Reconnect when the container has no shell or the instance is gone", () => {
    expect(endedNotice({ phase: 'ended', message: 'x', reason: 'NoShell' }, false)).toMatchObject({
      kind: 'warning',
      title: "Couldn't open the shell",
      canReconnect: false,
    });
    expect(endedNotice({ phase: 'ended', message: 'x', reason: 'InstanceNotFound' }, true).canReconnect).toBe(false);
  });

  test("doesn't offer Reconnect after a permission or runtime refusal", () => {
    expect(endedNotice({ phase: 'ended', message: 'x', reason: 'HTTP403' }, false)).toMatchObject({
      kind: 'error',
      canReconnect: false,
    });
    expect(endedNotice({ phase: 'ended', message: 'x', reason: 'HTTP422' }, false).canReconnect).toBe(false);
  });
});
