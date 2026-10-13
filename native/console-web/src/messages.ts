/**
 * Page ↔ worker messages. Ported from datum-cloud/compute
 * `ui/consumer/src/lib/console-client/messages.ts` at af9d7d3b (AGPL-3.0,
 * Datum Technology): `load` carries the compiled module (or its bytes)
 * instead of asset URLs.
 */
import type { ConsoleEnding, ConsoleTarget, TerminalSize } from '../../../src/resources/console/control-plane';

export type ToWorker =
  | { type: 'load'; module?: WebAssembly.Module; bytes?: ArrayBuffer }
  | { type: 'connect'; target: ConsoleTarget; size: TerminalSize }
  | { type: 'input'; data: string }
  | { type: 'resize'; size: TerminalSize }
  | { type: 'close' };

export type FromWorker =
  | { type: 'loaded'; publicKey: string }
  | { type: 'connected' }
  | { type: 'output'; bytes: Uint8Array }
  | { type: 'end'; ending: ConsoleEnding }
  | { type: 'failed'; message: string };
