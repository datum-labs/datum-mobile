import { CardContent, CardField, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  CategoryBarChart,
  KpiGrid,
  KpiTile,
  MetricCard,
  MetricCardSkeleton,
  MetricLegend,
  MetricRangeMenu,
  MetricsUnavailableNotice,
  MetricValue,
  TimeSeriesChart,
} from '@/components/Metrics';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, NoProjectState } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { useMetricRange } from '@/hooks/useMetricRange';
import {
  ALB_METRIC_RANGES,
  formatCount,
  formatMs,
  formatPercent,
  formatRps,
  formatShortNumber,
  metricRangePreset,
  type WafRuleRow as WafRuleRowData,
} from '@/lib/metrics';
import { useHttpProxy } from '@/resources/http-proxies/queries';
import { STATUS_CLASSES, WAF_OUTCOMES, useAlbMetrics, type WafOutcome } from '@/resources/metrics/queries';
import { Card } from '@/components/Grouped';

const WAF_LABELS: Record<WafOutcome, string> = { allowed: 'Allowed', blocked: 'Blocked', dropped: 'Dropped' };

/** Quiet regions need more places; a trickle below that reads "<0.001", not zero. */
const regionRps = (rps: number) => (rps > 0 && rps < 0.001 ? '<0.001 req/s' : formatRps(rps, rps < 0.1 ? 3 : 2));

const fmtOr = (value: number | null | undefined, format: (v: number) => string) =>
  value === null || value === undefined ? undefined : format(value);

/** One rule: its CRS name, id, category and action, with events and share of all rule events. */
function WafRuleRow({ rule, first }: { rule: WafRuleRowData; first: boolean }) {
  const t = useDatumTheme();
  const detail = [rule.category, rule.actions.join(', ')].filter(Boolean).join(' · ');
  return (
    <View
      style={[styles.ruleRow, !first && { borderTopColor: t.colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
      accessible
      accessibilityLabel={`${rule.name}, rule ${rule.ruleId}${detail ? `, ${detail}` : ''}: ${formatCount(rule.events)} events, ${Math.round(rule.share * 100)}%`}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text size="sm" weight="medium" numberOfLines={2}>
          {rule.name}
        </Text>
        <Text size="xs" tone="muted" numberOfLines={1}>
          <Text size="xs" tone="muted" mono>
            {rule.ruleId}
          </Text>
          {detail ? ` · ${detail}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text size="sm" weight="semibold" style={styles.tabular}>
          {formatCount(rule.events)}
        </Text>
        <Text size="xs" tone="muted" style={styles.tabular}>
          {`${Math.round(rule.share * 100)}%`}
        </Text>
      </View>
    </View>
  );
}

export default function AlbMetrics() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const proxy = useHttpProxy(projectId, id);
  const control = useMetricRange(ALB_METRIC_RANGES);
  const metrics = useAlbMetrics(projectId, id, control.range);
  const t = useDatumTheme();

  const { data, loading, unavailable, error } = metrics;
  const rangeLabel = metricRangePreset(control.range).label;
  const classColor = { '2XX': t.colors.success, '3XX': t.colors.info, '4XX': t.colors.warning, '5XX': t.colors.destructive };
  const wafColor: Record<WafOutcome, string> = {
    allowed: t.colors.success,
    blocked: t.colors.destructive,
    dropped: t.colors.warning,
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Metrics' }} />
      <MetricRangeMenu control={control} hidden={!projectId || unavailable} />
      <Screen onRefresh={unavailable ? undefined : metrics.refetch}>
        {!projectId ? (
          <NoProjectState />
        ) : unavailable ? (
          <MetricsUnavailableNotice />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void metrics.refetch()} />
        ) : (
          <>
            <Text size="xs" tone="muted" style={{ paddingHorizontal: 4 }} numberOfLines={2}>
              {[proxy.data?.displayName, rangeLabel].filter(Boolean).join(' · ')}
            </Text>

            <KpiGrid>
              <KpiTile
                label="Requests/s"
                value={fmtOr(data.rps.current, formatRps)}
                points={data.rps.points}
                end={metrics.windowEnd}
                color={t.colors.primary}
                loading={loading}
              />
              <KpiTile
                label="Error rate"
                value={fmtOr(data.errorRate.current, formatPercent)}
                points={data.errorRate.points}
                end={metrics.windowEnd}
                color={t.colors.destructive}
                loading={loading}
              />
              <KpiTile
                label="p95 latency"
                value={fmtOr(data.percentiles.p95, formatMs)}
                points={data.p95.points}
                end={metrics.windowEnd}
                color={t.colors.primary}
                loading={loading}
              />
              <KpiTile
                label="Total requests"
                value={fmtOr(data.total, (v) => (v >= 1e6 ? formatShortNumber(v, 1) : formatCount(v)))}
                footnote={`In the ${rangeLabel.toLowerCase()}`}
                color={t.colors.primary}
                loading={loading}
              />
            </KpiGrid>

            {loading ? (
              <>
                <MetricCardSkeleton />
                <MetricCardSkeleton />
              </>
            ) : (
              <>
                {data.byClass ? (
                  <MetricCard title="Responses" caption={rangeLabel}>
                    <CategoryBarChart
                      height={140}
                      bars={STATUS_CLASSES.map((c) => ({
                        label: c.toLowerCase(),
                        value: Math.round(data.byClass?.[c] ?? 0),
                        color: classColor[c],
                      }))}
                    />
                    <MetricLegend
                      items={STATUS_CLASSES.map((c) => ({
                        label: c.toLowerCase(),
                        value: formatCount(data.byClass?.[c] ?? 0),
                        color: classColor[c],
                      }))}
                    />
                  </MetricCard>
                ) : null}

                <MetricCard
                  title="Latency"
                  caption={
                    data.p95.points.length > 0
                      ? `p95 · peak ${formatMs(Math.max(...data.p95.points.map((p) => p.v)))}`
                      : 'p95'
                  }>
                  {data.p95.points.length > 0 ? (
                    <TimeSeriesChart
                      points={data.p95.points}
                      end={metrics.windowEnd}
                      color={t.colors.primary}
                      height={150}
                      type="line"
                      timeAxis
                      formatValue={formatMs}
                    />
                  ) : (
                    <Text size="sm" tone="muted">
                      No requests in this window.
                    </Text>
                  )}
                  <MetricLegend
                    items={[
                      { label: 'p50', value: fmtOr(data.percentiles.p50, formatMs) ?? '—' },
                      { label: 'p95', value: fmtOr(data.percentiles.p95, formatMs) ?? '—' },
                      { label: 'p99', value: fmtOr(data.percentiles.p99, formatMs) ?? '—' },
                    ]}
                  />
                </MetricCard>

                {data.waf ? (
                  <MetricCard title="Web application firewall" caption={rangeLabel}>
                    <CategoryBarChart
                      height={150}
                      bars={WAF_OUTCOMES.map((o) => ({
                        label: WAF_LABELS[o],
                        value: Math.round(data.waf?.[o] ?? 0),
                        color: wafColor[o],
                      }))}
                    />
                    <MetricLegend
                      items={WAF_OUTCOMES.map((o) => ({
                        label: WAF_LABELS[o],
                        value: formatCount(data.waf?.[o] ?? 0),
                        color: wafColor[o],
                      }))}
                    />
                  </MetricCard>
                ) : null}

                {data.waf ? (
                  <MetricCard
                    title="Top WAF rules"
                    caption={data.wafRules.find((rule) => rule.version)?.version ?? rangeLabel}>
                    {data.wafRules.length > 0 ? (
                      <View>
                        {data.wafRules.map((rule, i) => (
                          <WafRuleRow key={rule.ruleId} rule={rule} first={i === 0} />
                        ))}
                      </View>
                    ) : (
                      <Text size="sm" tone="muted">
                        No rules triggered in this window.
                      </Text>
                    )}
                  </MetricCard>
                ) : null}

                {data.regions.length > 1 ? (
                  <Section title="Regions · average requests/s">
                    <Card size="sm" sectioned>
                      <CardContent padding="none">
                        {data.regions.map((r) => (
                          <CardField
                            key={r.region}
                            label={r.region}
                            value={
                              <View style={{ alignItems: 'flex-end' }}>
                                <MetricValue text={regionRps(r.rps)} size="md" />
                              </View>
                            }
                          />
                        ))}
                      </CardContent>
                    </Card>
                  </Section>
                ) : null}
              </>
            )}
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  tabular: { fontVariant: ['tabular-nums'] },
});
