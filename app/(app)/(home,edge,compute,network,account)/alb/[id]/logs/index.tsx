import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { LogHeaderControls, LogSummary, NoLogsAccessState, NoLogsState } from '@/components/LogControls';
import { LogList, LogNote, LogRowSkeletons } from '@/components/LogList';
import { AccessLogRow } from '@/components/LogRows';
import { Segmented } from '@/components/Segmented';
import { ErrorState, NoProjectState } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { useLogControls } from '@/hooks/useLogControls';
import { pluralize } from '@/lib/format';
import { logRangePreset, type AccessLogEntry, type HttpStatusClass } from '@/lib/logs';
import { useHttpProxy } from '@/resources/http-proxies/queries';
import { isLogsForbidden, useAlbLogs, useLogsPermission } from '@/resources/logs/queries';

const STATUS_SEGMENTS = [
  { value: 'all', label: 'All' },
  { value: '2xx', label: '2xx' },
  { value: '3xx', label: '3xx' },
  { value: '4xx', label: '4xx' },
  { value: '5xx', label: '5xx' },
] as const;
type StatusSegment = (typeof STATUS_SEGMENTS)[number]['value'];

export default function AlbAccessLogs() {
  const { id, status: statusParam } = useLocalSearchParams<{ id: string; status?: string }>();
  const projectId = useProjectId();
  const proxy = useHttpProxy(projectId, id);
  const controls = useLogControls();
  const [status, setStatus] = useState<StatusSegment>(
    () => STATUS_SEGMENTS.find((s) => s.value === statusParam)?.value ?? 'all'
  );
  const permission = useLogsPermission(projectId);
  const logs = useAlbLogs(projectId, id, {
    range: controls.range,
    search: controls.search,
    live: controls.live,
    statusClass: status === 'all' ? undefined : (status as HttpStatusClass),
    enabled: permission.status !== 'denied',
  });

  const denied = permission.status === 'denied' || isLogsForbidden(logs.error);
  const page = logs.data;

  const openEntry = useCallback(
    (entry: AccessLogEntry) =>
      router.push(
        `/alb/${encodeURIComponent(id)}/logs/${entry.timestampNs}${
          entry.requestId ? `?rid=${encodeURIComponent(entry.requestId)}` : ''
        }`
      ),
    [id]
  );
  const renderRow = useCallback(
    (entry: AccessLogEntry) => <AccessLogRow entry={entry} onPress={openEntry} />,
    [openEntry]
  );

  const placeholder = !projectId ? (
    <NoProjectState />
  ) : denied ? (
    <NoLogsAccessState />
  ) : page ? (
    page.entries.length === 0 ? (
      <NoLogsState noun="requests" range={controls.range} search={controls.search} onWiden={controls.setRange} />
    ) : null
  ) : logs.error ? (
    <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
  ) : (
    <LogRowSkeletons />
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Access logs' }} />
      <LogHeaderControls controls={controls} searchPlaceholder="Path or host" hidden={denied || !projectId} />
      <LogList
        testID="alb-logs"
        data={page?.entries ?? []}
        renderRow={renderRow}
        placeholder={placeholder}
        onRefresh={() => Promise.all([logs.refetch(), denied ? permission.refetch() : undefined])}
        header={
          denied || !projectId ? null : (
            <>
              <Segmented options={STATUS_SEGMENTS} value={status} onChange={setStatus} />
              <LogSummary
                live={controls.live}
                updatedAt={page ? logs.dataUpdatedAt : undefined}
                parts={[
                  proxy.data?.displayName,
                  logRangePreset(controls.range).label,
                  page &&
                    (controls.search.trim()
                      ? `${page.entries.length} of ${pluralize(page.total, 'request')}`
                      : pluralize(page.total, 'request')),
                ]}
              />
            </>
          )
        }
        footer={
          page?.limited ? (
            <LogNote>{`Showing the latest ${page.total} requests. Choose a shorter time range to see the rest.`}</LogNote>
          ) : null
        }
      />
    </>
  );
}
