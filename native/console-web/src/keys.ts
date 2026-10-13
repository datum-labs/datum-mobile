/**
 * What the accessory row's keys send. iOS keyboards have no Esc, Tab, Ctrl
 * or arrows, so the app sends these by name and the page turns them into the
 * bytes a terminal would, honouring the cursor-key mode the program set.
 */
import type { AccessoryKey } from '../../../src/resources/console/protocol';

const CURSOR: Record<'up' | 'down' | 'right' | 'left', string> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
};

/**
 * The bytes for an accessory key. Arrows are `ESC [ A` normally and `ESC O A`
 * in application cursor mode (DECCKM), which full-screen programs such as
 * `vi` and `less` turn on.
 */
export function keySequence(key: AccessoryKey, applicationCursor: boolean): string {
  switch (key) {
    case 'esc':
      return '\x1b';
    case 'tab':
      return '\t';
    default:
      return `\x1b${applicationCursor ? 'O' : '['}${CURSOR[key]}`;
  }
}

const CTRL_SYMBOLS: Record<string, string> = {
  ' ': '\x00',
  '@': '\x00',
  '2': '\x00',
  '[': '\x1b',
  '3': '\x1b',
  '\\': '\x1c',
  '4': '\x1c',
  ']': '\x1d',
  '5': '\x1d',
  '^': '\x1e',
  '6': '\x1e',
  '_': '\x1f',
  '-': '\x1f',
  '7': '\x1f',
  '?': '\x7f',
  '8': '\x7f',
};

/**
 * The control character for Ctrl plus `data` (one typed character), as a
 * terminal sends it, or undefined when Ctrl doesn't change that key.
 */
export function withCtrl(data: string): string | undefined {
  if (data.length !== 1) return undefined;
  const code = data.charCodeAt(0);
  if ((code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a)) {
    return String.fromCharCode(code & 0x1f);
  }
  return CTRL_SYMBOLS[data];
}
