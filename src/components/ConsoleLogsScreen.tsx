import { Stack } from 'expo-router';
import { useCallback } from 'react';

import { useProjectId } from '@/context/ProjectContext';
import { useLogControls } from '@/hooks/useLogControls';
import { pluralize } from '@/lib/format';
import { logRangePreset, shortInstanceName, type ConsoleLogEntry } from '@/lib/logs';
import { isLogsForbidden, useInstanceLogs, useLogsPermission } from '@/resources/logs/queries';

import { LogHeaderControls, LogSummary, NoLogsAccessState, NoLogsState } from './LogControls';
import { LogList, LogNote, LogRowSkeletons } from './LogList';
import { ConsoleLogRow } from './LogRows';
import { EmptyState, ErrorState, NoProjectState } from './states';

/**
 * Console output for one instance or every instance of a workload (one
 * `datum_instance_name=~"a|b"` selector). Rows name their instance when more
 * than one is merged.
 */
export function ConsoleLogsScreen({
  title,
  context,
  instanceNames,
  workloadName,
  instancesError,
  onRefreshInstances,
}: {
  title: string;
  /** First part of the summary line, e.g. the workload or instance name. */
  context?: string;
  /** Undefined while the instance list is still loading. */
  instanceNames: readonly string[] | undefined;
  workloadName?: string;
  instancesError?: unknown;
  onRefreshInstances?: () => Promise<unknown>;
}) {
  const projectId = useProjectId();
  const controls = useLogControls();
  const permission = useLogsPermission(projectId);
  const logs = useInstanceLogs(projectId, instanceNames, {
    range: controls.range,
    search: controls.search,
    live: controls.live,
    enabled: permission.status !== 'denied',
  });

  const denied = permission.status === 'denied' || isLogsForbidden(logs.error);
  const page = logs.data;
  const merged = (instanceNames?.length ?? 0) > 1;
  const noInstances = instanceNames !== undefined && instanceNames.length === 0;

  const renderRow = useCallback(
    (entry: ConsoleLogEntry) => (
      <ConsoleLogRow entry={entry} instanceLabel={merged ? shortInstanceName(entry.instance, workloadName) : undefined} />
    ),
    [merged, workloadName]
  );

  const placeholder = !projectId ? (
    <NoProjectState />
  ) : denied ? (
    <NoLogsAccessState />
  ) : noInstances ? (
    <EmptyState title="No instances yet" description="Logs appear once an instance of this workload starts." />
  ) : instanceNames === undefined && instancesError ? (
    <ErrorState error={instancesError} onRetry={onRefreshInstances ? () => void onRefreshInstances() : undefined} />
  ) : page ? (
    page.entries.length === 0 ? (
      <NoLogsState noun="log lines" range={controls.range} search={controls.search} onWiden={controls.setRange} />
    ) : null
  ) : logs.error ? (
    <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
  ) : (
    <LogRowSkeletons lines={3} />
  );

  const showControls = !!projectId && !denied && !noInstances;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <LogHeaderControls controls={controls} searchPlaceholder="Message or instance" hidden={!showControls} />
      <LogList
        testID="console-logs"
        data={page?.entries ?? []}
        renderRow={renderRow}
        placeholder={placeholder}
        onRefresh={() =>
          Promise.all([logs.refetch(), onRefreshInstances?.(), denied ? permission.refetch() : undefined])
        }
        header={
          showControls ? (
            <LogSummary
              live={controls.live}
              updatedAt={page ? logs.dataUpdatedAt : undefined}
              parts={[
                context,
                merged && instanceNames ? pluralize(instanceNames.length, 'instance') : undefined,
                logRangePreset(controls.range).label,
                page &&
                  (controls.search.trim()
                    ? `${page.entries.length} of ${pluralize(page.total, 'line')}`
                    : pluralize(page.total, 'line')),
              ]}
            />
          ) : null
        }
        footer={
          page?.limited ? (
            <LogNote>{`Showing the latest ${page.total} lines. Choose a shorter time range to see the rest.`}</LogNote>
          ) : null
        }
      />
    </>
  );
}
