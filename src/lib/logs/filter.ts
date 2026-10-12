// Adapted from datum-ui packages/datum-ui/src/components/features/logs/utils/facets.ts
// (`filterEntries`, `searchableLogText`) at 1593e7c and cloud-portal
// app/resources/o11y-logs/o11y-log.helpers.ts (`filterAlbLogsByHost`) at a7010d0e: one search
// box instead of facets, matched against only what a row shows so a hit is always visible.
import { albHostValues, type AccessLogEntry } from './access-log';
import type { ConsoleLogEntry } from './console-log';

function normalise(search: string | undefined): string {
  return (search ?? '').trim().toLowerCase();
}

/** Path, every host on the request, method and status. */
export function accessLogSearchText(entry: AccessLogEntry): string {
  return [
    entry.path ?? '',
    ...albHostValues(entry.fields),
    entry.method ?? '',
    entry.status !== undefined ? String(entry.status) : '',
    entry.line,
  ]
    .join('\n')
    .toLowerCase();
}

export function filterAccessLogs(entries: readonly AccessLogEntry[], search?: string): AccessLogEntry[] {
  const query = normalise(search);
  if (!query) return [...entries];
  return entries.filter((entry) => accessLogSearchText(entry).includes(query));
}

/** Message, plus instance and container so "us-east-1-0" narrows a merged view. */
export function filterConsoleLogs(entries: readonly ConsoleLogEntry[], search?: string): ConsoleLogEntry[] {
  const query = normalise(search);
  if (!query) return [...entries];
  return entries.filter((entry) =>
    [entry.message, entry.instance ?? '', entry.container ?? ''].join('\n').toLowerCase().includes(query)
  );
}
