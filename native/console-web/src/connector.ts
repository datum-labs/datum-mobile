/**
 * One shell client in its own Web Worker. Ported from datum-cloud/compute
 * `ui/consumer/src/lib/console-client/connector.ts` at af9d7d3b (AGPL-3.0,
 * Datum Technology). Differences: the worker is spawned from a Blob of the
 * bundled worker source (the page is a file in the app bundle), and `load`
 * hands it the compiled module the page holds, or a copy of the bytes when
 * the module can't be posted.
 */
import type { ConsoleEnding, ShellConnector } from '../../../src/resources/console/control-plane';
import type { FromWorker, ToWorker } from './messages';

export const CLOSE_TIMEOUT_MS = 2_000;

export interface ShellWorker {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** The module the page compiled once, and its bytes. */
export interface ConsoleWasm {
  module: WebAssembly.Module;
  bytes: ArrayBuffer;
}

export function createWorkerConnector(
  wasm: () => Promise<ConsoleWasm>,
  spawn: () => ShellWorker,
  closeTimeoutMs = CLOSE_TIMEOUT_MS
): ShellConnector {
  const worker = spawn();
  const send = (message: ToWorker, transfer?: Transferable[]) => worker.postMessage(message, transfer);
  let loaded: ((publicKey: string) => void) | undefined;
  let failed: ((err: Error) => void) | undefined;
  let onOutput: ((bytes: Uint8Array) => void) | undefined;
  let onEnd: ((ending: ConsoleEnding) => void) | undefined;
  let onConnected: (() => void) | undefined;
  let streaming = false;
  let ended = false;
  let done = false;
  let disposed = false;
  let afterEnd: (() => void) | undefined;

  const finish = (ending: ConsoleEnding) => {
    ended = true;
    afterEnd?.();
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

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    switch (message.type) {
      case 'loaded':
        loaded?.(message.publicKey);
        loaded = undefined;
        failed = undefined;
        break;
      case 'connected':
        onConnected?.();
        break;
      case 'output':
        onOutput?.(message.bytes);
        break;
      case 'end':
        finish(message.ending);
        break;
      case 'failed':
        fail(message.message);
        break;
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    ended = true;
    afterEnd?.();
    fail('The shell client stopped unexpectedly.');
  };

  return {
    load() {
      return new Promise<string>((resolve, reject) => {
        loaded = resolve;
        failed = reject;
        wasm().then(
          ({ module, bytes }) => {
            try {
              send({ type: 'load', module });
            } catch {
              // WebKit can't always clone a module into a worker; send bytes.
              const copy = bytes.slice(0);
              send({ type: 'load', bytes: copy }, [copy]);
            }
          },
          (err: unknown) => fail(err instanceof Error ? err.message : String(err))
        );
      });
    },
    connect(target, size, output, end, connected) {
      onOutput = output;
      onEnd = end;
      onConnected = connected;
      streaming = true;
      send({ type: 'connect', target, size });
    },
    write(data) {
      send({ type: 'input', data });
    },
    resize(size) {
      send({ type: 'resize', size });
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
      if (!streaming || ended) {
        worker.terminate();
        return;
      }
      const timer = setTimeout(() => worker.terminate(), closeTimeoutMs);
      afterEnd = () => {
        clearTimeout(timer);
        worker.terminate();
      };
      send({ type: 'close' });
    },
  };
}
