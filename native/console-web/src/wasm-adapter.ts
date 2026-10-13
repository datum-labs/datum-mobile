/**
 * Starts compute's console session client (`cmd/console-wasm`, the global
 * `datumExec`) and wraps it in the shape the shell session drives.
 *
 * Ported from datum-cloud/compute `ui/consumer/src/lib/console-client/wasm-adapter.ts`
 * at af9d7d3b (AGPL-3.0, Datum Technology). The portal fetches the module
 * and its loader by URL; here the loader (`wasm_exec.js`) is already
 * evaluated in the worker and the page hands over a compiled module, because
 * a WebView page served from the app bundle can't `fetch` file URLs.
 *
 * No runtime imports and erasable TypeScript only, so the Node e2e script
 * (`scripts/console-e2e.mjs`) runs the same adapter against the same WASM.
 */
import type { ConsoleEnding, ConsoleTarget, TerminalSize } from '../../../src/resources/console/control-plane';

export interface ConsoleStream {
  write(data: string | Uint8Array): void;
  resize(size: TerminalSize): void;
  close(): void;
}

export interface ConsoleClient {
  /** Features the module advertises (`datumExec.features`). */
  features: string[];
  publicKey(): string;
  connect(
    target: ConsoleTarget,
    size: TerminalSize,
    onOutput: (bytes: Uint8Array) => void,
    onEnd: (ending: ConsoleEnding) => void,
    onConnected: () => void
  ): ConsoleStream;
}

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

interface DatumExec {
  features?: string[];
  publicKey(): string;
  connect(
    session: ConsoleTarget & Partial<TerminalSize>,
    onOutput: (bytes: Uint8Array, fd: number) => void,
    onEnd: (ending: Partial<ConsoleEnding>) => void,
    onConnected?: () => void
  ): {
    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
    close(): void;
  };
}

export interface ConsoleScope {
  Go?: new () => GoRuntime;
  datumExec?: DatumExec;
}

const PUBLIC_KEY = /^[0-9a-f]{64}$/;

async function instantiate(
  wasm: WebAssembly.Module | ArrayBuffer | Uint8Array,
  imports: WebAssembly.Imports
): Promise<WebAssembly.Instance> {
  if (wasm instanceof WebAssembly.Module) return WebAssembly.instantiate(wasm, imports);
  return (await WebAssembly.instantiate(wasm as BufferSource, imports)).instance;
}

/** Runs the module (its `main` registers `datumExec`) and returns the client. */
export async function loadConsoleClient(
  wasm: WebAssembly.Module | ArrayBuffer | Uint8Array,
  scope: ConsoleScope = globalThis as unknown as ConsoleScope
): Promise<ConsoleClient> {
  if (!scope.Go) throw new Error('The shell client runtime did not load.');
  const go = new scope.Go();
  void go.run(await instantiate(wasm, go.importObject));

  const exec = scope.datumExec;
  if (!exec) throw new Error('The shell client did not start.');
  const features = Array.isArray(exec.features) ? exec.features : [];
  const signalsConnected = features.includes('connected');

  return {
    features,
    publicKey() {
      const key = exec.publicKey();
      if (!PUBLIC_KEY.test(key)) throw new Error('The shell client produced an invalid key.');
      return key;
    },
    connect(target, size, onOutput, onEnd, onConnected) {
      let connected = false;
      const markConnected = () => {
        if (connected) return;
        connected = true;
        onConnected();
      };
      const session = {
        uid: target.uid,
        endpointID: target.endpointID,
        relayURLs: target.relayURLs,
        target: target.target,
        cols: size.cols,
        rows: size.rows,
      };
      const output = (bytes: Uint8Array) => {
        markConnected();
        onOutput(bytes);
      };
      const end = (ending: Partial<ConsoleEnding>) =>
        onEnd({
          exitCode: ending.exitCode ?? 1,
          reason: ending.reason ?? '',
          message: ending.message ?? '',
          error: ending.error ?? '',
        });
      const stream = signalsConnected
        ? exec.connect(session, output, end, markConnected)
        : exec.connect(session, output, end);
      return {
        write: (data) => stream.write(data),
        resize: ({ cols, rows }) => stream.resize(cols, rows),
        close: () => stream.close(),
      };
    },
  };
}
