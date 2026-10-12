import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack } from 'expo-router';

import { useProjectId } from '@/context/ProjectContext';
import { useMetricRange } from '@/hooks/useMetricRange';
import { pluralize } from '@/lib/format';
import { COMPUTE_METRIC_RANGES, formatBytes, formatCores, metricRangePreset, type MetricPoint } from '@/lib/metrics';
import { useComputeMetrics } from '@/resources/metrics/queries';

import {
  MetricCard,
  MetricCardSkeleton,
  MetricLegend,
  MetricRangeMenu,
  MetricsUnavailableNotice,
  TimeSeriesChart,
} from './Metrics';
import { Screen } from './Screen';
import { EmptyState, ErrorState, NoProjectState } from './states';

const peak = (points: readonly MetricPoint[]) => (points.length ? Math.max(...points.map((p) => p.v)) : null);
const cores = (v: number | null) => (v === null ? '—' : `${formatCores(v)} cores`);
const bytes = (v: number | null) => (v === null ? '—' : formatBytes(v));

/**
 * CPU (cores) and memory (bytes) for one instance or summed over a
 * workload's instances, with a header time-range menu (1h / 6h / 24h).
 */
export function ComputeMetricsScreen({
  context,
  queries,
  instanceCount,
  instancesError,
  onRefreshInstances,
}: {
  /** First part of the summary line: the workload or instance name. */
  context?: string;
  /** The compute UI's PromQL; undefined while the instance list loads. */
  queries: { cpu: string | undefined; memory: string | undefined } | undefined;
  /** For a workload: how many instances are summed (0 shows an empty state). */
  instanceCount?: number;
  instancesError?: unknown;
  onRefreshInstances?: () => Promise<unknown>;
}) {
  const t = useDatumTheme();
  const projectId = useProjectId();
  const control = useMetricRange(COMPUTE_METRIC_RANGES);
  const metrics = useComputeMetrics(projectId ? queries : undefined, control.range);
  const { data, unavailable, error } = metrics;
  const rangeLabel = metricRangePreset(control.range).label;
  const noInstances = instanceCount === 0;
  const loading = metrics.loading || (!queries && !instancesError && !noInstances);
  const empty = !loading && data.cpu.points.length === 0 && data.memory.points.length === 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Metrics' }} />
      <MetricRangeMenu control={control} hidden={!projectId || unavailable || noInstances} />
      <Screen
        onRefresh={
          unavailable ? undefined : () => Promise.all([metrics.refetch(), onRefreshInstances?.()])
        }>
        {!projectId ? (
          <NoProjectState />
        ) : unavailable ? (
          <MetricsUnavailableNotice />
        ) : noInstances ? (
          <EmptyState title="No instances yet" description="Metrics appear once an instance of this workload starts." />
        ) : !queries && instancesError ? (
          <ErrorState
            error={instancesError}
            onRetry={onRefreshInstances ? () => void onRefreshInstances() : undefined}
          />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void metrics.refetch()} />
        ) : (
          <>
            <Text size="xs" tone="muted" style={{ paddingHorizontal: 4 }} numberOfLines={2}>
              {[
                context,
                instanceCount && instanceCount > 1 ? `Sum of ${pluralize(instanceCount, 'instance')}` : undefined,
                rangeLabel,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {loading ? (
              <>
                <MetricCardSkeleton />
                <MetricCardSkeleton />
              </>
            ) : empty ? (
              <EmptyState
                title={`No metrics in the ${rangeLabel.toLowerCase()}`}
                description="CPU and memory show up here while an instance is running."
              />
            ) : (
              <>
                <MetricCard title="CPU" caption="cores in use">
                  {data.cpu.points.length > 0 ? (
                    <TimeSeriesChart
                      points={data.cpu.points}
                      end={metrics.windowEnd}
                      color={t.colors.info}
                      height={140}
                      timeAxis
                    />
                  ) : null}
                  <MetricLegend
                    items={[
                      { label: 'Now', value: cores(data.cpu.current) },
                      { label: 'Peak', value: cores(peak(data.cpu.points)) },
                    ]}
                  />
                </MetricCard>
                <MetricCard title="Memory" caption="working set">
                  {data.memory.points.length > 0 ? (
                    <TimeSeriesChart
                      points={data.memory.points}
                      end={metrics.windowEnd}
                      color={t.colors.primary}
                      height={140}
                      timeAxis
                    />
                  ) : null}
                  <MetricLegend
                    items={[
                      { label: 'Now', value: bytes(data.memory.current) },
                      { label: 'Peak', value: bytes(peak(data.memory.points)) },
                    ]}
                  />
                </MetricCard>
              </>
            )}
          </>
        )}
      </Screen>
    </>
  );
}
