/**
 * The shell client's Web Worker: runs compute's console WASM so its private
 * key stays out of the page. `wasm_exec.js` is prepended to this bundle by
 * scripts/build-console-web.mjs, so `Go` is already defined.
 *
 * Ported from datum-cloud/compute `ui/consumer/src/lib/console-client/shell.worker.ts`
 * at af9d7d3b (AGPL-3.0, Datum Technology).
 */
import type { FromWorker, ToWorker } from './messages';
import { loadConsoleClient, type ConsoleClient, type ConsoleStream } from './wasm-adapter';

interface WorkerScope {
  postMessage(message: FromWorker, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;

let client: ConsoleClient | undefined;
let stream: ConsoleStream | undefined;

function post(message: FromWorker, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

scope.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'load': {
        const wasm = message.module ?? message.bytes;
        if (!wasm) throw new Error('The shell client is not part of this build.');
        client = await loadConsoleClient(wasm);
        post({ type: 'loaded', publicKey: client.publicKey() });
        break;
      }
      case 'connect':
        if (!client) throw new Error('The shell client is not loaded.');
        stream = client.connect(
          message.target,
          message.size,
          (bytes) => {
            const copy = bytes.slice();
            post({ type: 'output', bytes: copy }, [copy.buffer]);
          },
          (ending) => post({ type: 'end', ending }),
          () => post({ type: 'connected' })
        );
        break;
      case 'input':
        stream?.write(message.data);
        break;
      case 'resize':
        stream?.resize(message.size);
        break;
      case 'close':
        stream?.close();
        break;
    }
  } catch (err) {
    post({ type: 'failed', message: errorMessage(err) });
  }
};
