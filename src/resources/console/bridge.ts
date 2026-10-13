/**
 * The app's side of the terminal bridge: a `ShellConnector` that drives the
 * shell client running in the WebView page (see protocol.ts).
 *
 * `ShellSession` creates one connector per attempt, as it does with the
 * portal's worker connector. Each gets its own `sid`; `load` asks the page for
 * a fresh client and its public key, `connect` hands over the ready session,
 * and `dispose` tells the page to close the stream (the page waits for the
 * client to zero its key, as the portal's connector does, then stops it).
 * Output stays in the page; the connector only hears that some arrived.
 */
import type { ConsoleEnding, ShellConnector } from './control-plane';
import type { FromTerminal, ToTerminal } from './protocol';

/** How the connector reaches the page; the screen implements it over the WebView. */
export interface TerminalPort {
  send(message: ToTerminal): void;
  /** Subscribes to page messages; returns the unsubscribe. */
  subscribe(listener: (message: FromTerminal) => void): () => void;
}

export const LOAD_TIMEOUT_MS = 20_000;

let lastSid = 0;

/** A fresh session id, unique for this JS runtime. */
export function nextSid(): number {
  lastSid += 1;
  return lastSid;
}

export function createBridgeConnector(port: TerminalPort, sid: number = nextSid()): ShellConnector {
  let onOutput: ((bytes: Uint8Array) => void) | undefined;
  let onEnd: ((ending: ConsoleEnding) => void) | undefined;
  let onConnected: (() => void) | undefined;
  let loaded: ((key: string) => void) | undefined;
  let failed: ((err: Error) => void) | undefined;
  let done = false;
  let disposed = false;
  const empty = new Uint8Array(0);

  const finish = (ending: ConsoleEnding) => {
    if (done) return;
    done = true;
    onEnd?.(ending);
  };

  const fail = (message: string) => {
    if (failed) {
      failed(new Error(message));
      failed = undefined;
      loaded = undefined;
    } else if (onEnd) {
      finish({ exitCode: 1, reason: '', message: '', error: message });
    }
  };

  const unsubscribe = port.subscribe((message) => {
    if (disposed) return;
    // A page-wide error (the page crashed or failed to load) ends every session.
    if (message.type === 'error' && message.sid === undefined) return fail(message.message);
    if (!('sid' in message) || message.sid !== sid) return;
    switch (message.type) {
      case 'publicKey':
        loaded?.(message.key);
        loaded = undefined;
        failed = undefined;
        break;
      case 'connected':
        onConnected?.();
        break;
      case 'output-activity':
        onOutput?.(empty);
        break;
      case 'ended':
        finish(message.ending);
        break;
      case 'error':
        fail(message.message);
        break;
    }
  });

  return {
    load() {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => fail('The shell client took too long to start.'), LOAD_TIMEOUT_MS);
        loaded = (key) => {
          clearTimeout(timer);
          resolve(key);
        };
        failed = (err) => {
          clearTimeout(timer);
          reject(err);
        };
        port.send({ type: 'getPublicKey', sid });
      });
    },
    connect(target, _size, output, end, connected) {
      // The page sizes the stream from its own terminal.
      onOutput = output;
      onEnd = end;
      onConnected = connected;
      port.send({ type: 'connect', sid, target });
    },
    write(data) {
      port.send({ type: 'input', sid, data });
    },
    resize() {
      port.send({ type: 'resize' });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      done = true;
      onOutput = undefined;
      onEnd = undefined;
      onConnected = undefined;
      loaded = undefined;
      failed = undefined;
      unsubscribe();
      port.send({ type: 'end', sid });
    },
  };
}
