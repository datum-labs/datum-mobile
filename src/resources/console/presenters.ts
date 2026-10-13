import type { ShellState } from './control-plane';

export interface EndedNotice {
  kind: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  /** Whether a new session could do better (not after a permission or runtime refusal). */
  canReconnect: boolean;
}

/** Ending reasons that are a normal close, not something to warn about. */
const CALM = new Set(['', 'Completed', 'ClosedByUser', 'Closed']);
/**
 * Endings another session won't fix: a permission or runtime refusal, an
 * image without `sh` (every command runs through it) or an instance that's gone.
 */
const FINAL = new Set(['HTTP403', 'HTTP422', 'HTTP404', 'NoShell', 'InstanceNotFound']);

/**
 * The Notice for an ended shell. `reachedShell` says whether the terminal
 * ever connected: if it did, the output stays on screen above the Notice.
 */
export function endedNotice(state: Extract<ShellState, { phase: 'ended' }>, reachedShell: boolean): EndedNotice {
  const reason = state.reason ?? '';
  const calm = reachedShell && CALM.has(reason);
  return {
    kind: reason === 'HTTP403' ? 'error' : calm ? 'info' : 'warning',
    title: reachedShell ? 'Shell ended' : "Couldn't open the shell",
    description: state.message,
    canReconnect: !FINAL.has(reason),
  };
}
