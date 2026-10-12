// Ported from datum-ui packages/datum-ui/src/components/features/logs/utils/severity.ts and
// utils/constants.ts (SEVERITY_ORDER) at 1593e7c (badge types map 1:1 onto datum-ui-native's
// Badge). `logSeverity`'s line sniffing is the app's own: queryapi doesn't set `severity` on
// Unikraft console output, so the badge would otherwise always be blank.
export type LogBadgeType = 'danger' | 'warning' | 'info' | 'success' | 'muted';

export const SEVERITY_ORDER = ['ERROR', 'FATAL', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'TRACE'] as const;

const SEVERITY_BADGE: Record<string, LogBadgeType> = {
  ERROR: 'danger',
  FATAL: 'danger',
  CRITICAL: 'danger',
  WARN: 'warning',
  WARNING: 'warning',
  INFO: 'info',
  DEBUG: 'muted',
  TRACE: 'muted',
};

export function severityBadgeType(severity: string | undefined): LogBadgeType {
  if (!severity) return 'muted';
  return SEVERITY_BADGE[severity.toUpperCase()] ?? 'muted';
}

export function httpStatusBadgeType(status: number | undefined): LogBadgeType {
  if (status === undefined || !Number.isFinite(status)) return 'muted';
  if (status >= 500) return 'danger';
  if (status >= 400) return 'warning';
  if (status >= 300) return 'info';
  if (status >= 200) return 'success';
  return 'muted';
}

// ── Severity for a console line ──────────────────────────────────────────

export type LogSeverity = 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

const CANONICAL: Record<string, LogSeverity> = {
  FATAL: 'FATAL',
  PANIC: 'FATAL',
  CRITICAL: 'FATAL',
  CRIT: 'FATAL',
  EMERG: 'FATAL',
  ALERT: 'FATAL',
  ERROR: 'ERROR',
  ERR: 'ERROR',
  WARN: 'WARN',
  WARNING: 'WARN',
  INFO: 'INFO',
  NOTICE: 'INFO',
  DEBUG: 'DEBUG',
  TRACE: 'TRACE',
};

const SEVERITY_LABELS = ['severity', 'level', 'detected_level', 'severity_text'] as const;

/** Structured or conventional level markers near the start of a line. */
const LINE_PATTERNS: RegExp[] = [
  // {"level":"error"} / "severity": "WARN"
  /"(?:level|severity|lvl)"\s*:\s*"([a-z]+)"/i,
  // level=error / lvl=warn
  /\b(?:level|lvl|severity)=["']?([a-z]+)/i,
  // [ERROR] / [warn]
  /^\W{0,3}\[([a-z]+)\]/i,
  // ERROR: … / WARN  … / 2026-01-01T00:00:00Z INFO …
  /^(?:\S+\s+){0,2}(FATAL|PANIC|CRITICAL|ERROR|WARN|WARNING|INFO|DEBUG|TRACE)\b/,
];

/** `Error: …`, `TypeError: …`, `Uncaught ReferenceError: …` as runtimes print them. */
const THROWN_ERROR = /^\s*(?:Uncaught\s+)?(?:[A-Z][A-Za-z]*)?Error:\s/;

function canonical(value: string | undefined): LogSeverity | undefined {
  if (!value) return undefined;
  return CANONICAL[value.trim().toUpperCase()];
}

/**
 * Level for a log line: a stream label wins, then a level marker in the
 * line itself. Undefined when neither says (most raw stdout).
 */
export function logSeverity(labels: Record<string, string>, line: string): LogSeverity | undefined {
  for (const key of SEVERITY_LABELS) {
    const level = canonical(labels[key]);
    if (level) return level;
  }
  const head = line.slice(0, 200);
  for (const pattern of LINE_PATTERNS) {
    const level = canonical(pattern.exec(head)?.[1]);
    if (level) return level;
  }
  if (THROWN_ERROR.test(head)) return 'ERROR';
  return undefined;
}
