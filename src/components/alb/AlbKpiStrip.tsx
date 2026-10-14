import { Skeleton, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { MetricValue } from '@/components/Metrics';
import { PressableScale } from '@/components/PressableScale';
import { formatMs, formatPercent, formatRps, formatShortNumber } from '@/lib/metrics';
import { useProxyWaf } from '@/resources/http-proxies/queries';
import { useAlbKpis } from '@/resources/metrics/queries';

const fmtOr = (value: number | null, format: (v: number) => string) => (value === null ? '—' : format(value));

/**
 * Four headline numbers for an ALB over the last hour (the portal overview's
 * metrics strip): requests/s, error rate, p95 latency and WAF blocks. A 2×2
 * grid of small tiles; tapping anywhere calls `onPress` (the metrics screen).
 * Every value reads "—" when metrics aren't available or haven't arrived.
 */
export function AlbKpiStrip({
  projectId,
  proxyName,
  onPress,
}: {
  projectId: string;
  proxyName: string;
  onPress?: () => void;
}) {
  const t = useDatumTheme();
  const { data, loading, unavailable, error } = useAlbKpis(projectId, proxyName);
  const waf = useProxyWaf(projectId, proxyName);
  // As the portal: no blocks to count without a policy (403 on policies still counts metrics).
  const wafOff = !!waf.data && !waf.data.forbidden && waf.data.state === 'disabled';

  const tiles = [
    { label: 'Requests', value: fmtOr(data.rps, formatRps) },
    { label: 'Error rate', value: fmtOr(data.errorRate, formatPercent) },
    { label: 'p95 latency', value: fmtOr(data.p95, formatMs) },
    { label: 'WAF blocked', value: wafOff ? 'Off' : fmtOr(data.wafBlocked, (v) => formatShortNumber(v, 0)) },
  ];
  const summary = tiles.map((tile) => `${tile.label} ${tile.value}`).join(', ');
  const footnote = unavailable
    ? "Metrics aren't available for your account yet"
    : error
      ? "Couldn't load metrics"
      : ''; // The parent's "Last hour" section title already says it.

  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      haptic={!!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Metrics, ${(footnote || 'last hour').toLowerCase()}. ${summary}`}
      accessibilityHint={onPress ? 'Opens metrics' : undefined}
      style={styles.root}>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <View key={tile.label} style={styles.cell}>
            <View style={[styles.tile, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}>
              <Text size="xs" weight="medium" tone="muted" numberOfLines={1}>
                {tile.label}
              </Text>
              {loading ? <Skeleton width={64} height={22} radius={6} /> : <MetricValue text={tile.value} size="md" />}
            </View>
          </View>
        ))}
      </View>
      <View style={styles.footer}>
        <Text size="xs" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {footnote}
        </Text>
        {onPress ? (
          <View style={styles.more}>
            <Text size="xs" weight="medium" tone="primary">
              Metrics
            </Text>
            <Icon name="chevron.right" size={11} weight="semibold" color={t.colors.primary} />
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -4 },
  cell: { width: '50%', padding: 4 },
  tile: {
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
