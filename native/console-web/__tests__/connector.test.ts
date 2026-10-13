/**
 * Ported from datum-cloud/compute `ui/consumer/src/lib/console-client/connector.test.ts`
 * at af9d7d3b (AGPL-3.0, Datum Technology), plus the module hand-off.
 */
import { createWorkerConnector, type ConsoleWasm, type ShellWorker } from '../src/connector';
import type { FromWorker, ToWorker } from '../src/messages';

const EMPTY_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const target = { uid: 'u', endpointID: 'e', relayURLs: ['https://relay'], target: 't' };
const size = { cols: 80, rows: 24 };
const ending = { exitCode: 1, reason: '', message: '', error: 'closed' };

async function wasm(): Promise<ConsoleWasm> {
  const bytes = EMPTY_WASM_MODULE.slice().buffer;
  return { module: await WebAssembly.compile(bytes), bytes };
}

function fakeWorker(
  respond: (message: ToWorker, reply: (m: FromWorker) => void) => void,
  { refuseModules = false } = {}
) {
  const sent: ToWorker[] = [];
  let terminated = 0;
  const worker: ShellWorker = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      if (refuseModules && message.type === 'load' && message.module) {
        throw new Error('DataCloneError');
      }
      sent.push(message);
      respond(message, (reply) => worker.onmessage?.({ data: reply } as MessageEvent<FromWorker>));
    },
    terminate() {
      terminated++;
    },
  };
  return {
    worker,
    sent,
    get terminated() {
      return terminated;
    },
  };
}

describe('createWorkerConnector', () => {
  test('hands the worker the compiled module and returns its key', async () => {
    const fake = fakeWorker((m, reply) => {
      if (m.type === 'load') reply({ type: 'loaded', publicKey: 'ef'.repeat(32) });
    });
    const connector = createWorkerConnector(wasm, () => fake.worker);
    await expect(connector.load()).resolves.toBe('ef'.repeat(32));
    expect(fake.sent[0]).toMatchObject({ type: 'load' });
    expect((fake.sent[0] as { module?: unknown }).module).toBeInstanceOf(WebAssembly.Module);
  });

  test('sends the bytes when the module cannot be posted', async () => {
    const fake = fakeWorker(
      (m, reply) => {
        if (m.type === 'load') reply({ type: 'loaded', publicKey: 'ef'.repeat(32) });
      },
      { refuseModules: true }
    );
    const connector = createWorkerConnector(wasm, () => fake.worker);
    await connector.load();
    const load = fake.sent[0] as { bytes?: ArrayBuffer };
    expect(load.bytes?.byteLength).toBe(EMPTY_WASM_MODULE.byteLength);
  });

  test('rejects the load when the module is missing from the build', async () => {
    const fake = fakeWorker(() => undefined);
    const connector = createWorkerConnector(
      () => Promise.reject(new Error("The shell client isn't part of this build.")),
      () => fake.worker
    );
    await expect(connector.load()).rejects.toThrow(/isn't part of this build/);
  });

  test('relays the connected signal', () => {
    const fake = fakeWorker((m, reply) => {
      if (m.type === 'connect') reply({ type: 'connected' });
    });
    const connector = createWorkerConnector(wasm, () => fake.worker);
    const events: string[] = [];
    connector.connect(
      target,
      size,
      () => events.push('output'),
      () => events.push('end'),
      () => events.push('connected')
    );
    expect(events).toEqual(['connected']);
  });

  test('closes the client and waits for it to end before stopping the worker', () => {
    const fake = fakeWorker((m, reply) => {
      if (m.type === 'close') reply({ type: 'end', ending });
    });
    const connector = createWorkerConnector(wasm, () => fake.worker);
    const endings: unknown[] = [];
    connector.connect(target, size, () => undefined, (e) => endings.push(e), () => undefined);

    connector.dispose();

    expect(fake.sent.map((m) => m.type)).toEqual(['connect', 'close']);
    expect(fake.terminated).toBe(1);
    expect(endings).toEqual([]);
  });

  test('stops the worker after the timeout when the client never ends', async () => {
    const fake = fakeWorker(() => undefined);
    const connector = createWorkerConnector(wasm, () => fake.worker, 5);
    connector.connect(target, size, () => undefined, () => undefined, () => undefined);

    connector.dispose();
    expect(fake.terminated).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.terminated).toBe(1);
  });

  test('stops the worker at once when no connection is open', () => {
    const fake = fakeWorker(() => undefined);
    const connector = createWorkerConnector(wasm, () => fake.worker);
    connector.dispose();
    expect(fake.sent).toEqual([]);
    expect(fake.terminated).toBe(1);
  });

  test('stops the worker at once when the connection already ended', () => {
    const fake = fakeWorker((m, reply) => {
      if (m.type === 'connect') reply({ type: 'end', ending });
    });
    const connector = createWorkerConnector(wasm, () => fake.worker);
    connector.connect(target, size, () => undefined, () => undefined, () => undefined);
    connector.dispose();
    expect(fake.sent.map((m) => m.type)).toEqual(['connect']);
    expect(fake.terminated).toBe(1);
  });
});
