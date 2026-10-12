/**
 * Instance stdout arrives with terminal colour codes intact (Node prints
 * stack frames as `\x1b[90m    at …\x1b[39m`). The app shows plain text, so
 * CSI and OSC sequences are removed, along with stray carriage returns.
 */
const ANSI_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const LONE_ESC = /\u001b[@-Z\\-_]?/g;

export function stripAnsi(line: string): string {
  if (!line.includes('\u001b') && !line.includes('\r')) return line;
  return line.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(LONE_ESC, '').replace(/\r/g, '');
}
