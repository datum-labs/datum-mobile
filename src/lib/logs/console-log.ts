// Ported from compute ui/consumer/src/lib/o11y-logs.ts at 285fb19d (`pickComputeLogLabels`,
// `toComputeLogEntries`); ANSI stripping, severity and the short instance label are the app's own.
/**
 * Instance stdout (console) lines. Unikraft instances ship `vm.log`, one
 * stream per instance, with terminal colour codes and no `severity` label.
 */
import { stripAnsi } from './ansi';
import { flattenLokiStreams, type LogEntry, type LokiQueryRangeResponse } from './loki';
import { INSTANCE_LOG_LABEL } from './logql';
import { logSeverity, severityBadgeType, type LogBadgeType, type LogSeverity } from './severity';

const CONSOLE_LOG_LABELS = [
  'severity',
  'service_name',
  'resource_name',
  'k8s_container_name',
  'container',
  INSTANCE_LOG_LABEL,
  'datum_workload_name',
] as const;
const CONSOLE_LOG_LABEL_SET = new Set<string>(CONSOLE_LOG_LABELS);

export interface ConsoleLogEntry {
  id: string;
  timestampNs: string;
  timeMs: number;
  /** The line with terminal escapes removed. */
  message: string;
  instance?: string;
  container?: string;
  severity?: LogSeverity;
  badge: LogBadgeType;
  labels: Record<string, string>;
}

export function pickConsoleLogLabels(labels: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value && CONSOLE_LOG_LABEL_SET.has(key)) picked[key] = value;
  }
  return picked;
}

export function toConsoleLogEntry(entry: LogEntry): ConsoleLogEntry {
  const labels = pickConsoleLogLabels(entry.labels);
  const message = stripAnsi(entry.line);
  const severity = logSeverity(labels, message);
  return {
    id: entry.id,
    timestampNs: entry.timestampNs,
    timeMs: entry.timeMs,
    message,
    instance: labels[INSTANCE_LOG_LABEL],
    container: labels.k8s_container_name || labels.container,
    severity,
    badge: severityBadgeType(severity),
    labels,
  };
}

/**
 * Newest first. ALB access-log streams (they carry `route_name`) are dropped
 * in case a selector ever matches both. Ids carry the instance, not the stream
 * index, so they stay stable when a refetch reorders streams.
 */
export function toConsoleLogEntries(response: LokiQueryRangeResponse | undefined): ConsoleLogEntry[] {
  const seen = new Map<string, number>();
  return flattenLokiStreams(response)
    .filter((entry) => !entry.labels.route_name)
    .map((entry) => {
      const row = toConsoleLogEntry(entry);
      const base = `${row.timestampNs}-${row.instance ?? ''}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { ...row, id: n === 0 ? base : `${base}-${n}` };
    });
}

/**
 * Instance name without its workload prefix, for the per-row label when a
 * screen merges several instances: `web-ashburn-us-east-1-0` → `ashburn-us-east-1-0`.
 */
export function shortInstanceName(instance: string | undefined, workloadName?: string): string | undefined {
  if (!instance) return undefined;
  if (workloadName && instance.startsWith(`${workloadName}-`) && instance.length > workloadName.length + 1)
    return instance.slice(workloadName.length + 1);
  return instance;
}
