import { Skeleton, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { formatRegionDetail, formatRegionRps, type RegionRow } from '@/lib/metrics';
import { useAlbActiveRegions } from '@/resources/metrics/queries';

/**
 * Which regions serve this ALB (the portal's "Active POPs" globe, as a
 * list): every Location in the project, the ones with traffic first, each
 * with requests/s, p95 and 5xx share over the last 5 minutes. Regions
 * without traffic read "Idle". A caption and a card; the parent supplies
 * the section title.
 */
export function AlbActiveRegions({ projectId, proxyName }: { projectId: string; proxyName: string }) {
  const t = useDatumTheme();
  const { data, loading, unavailable, error } = useAlbActiveRegions(projectId, proxyName);
  const { rows, activeCount } = data;

  const caption = unavailable
    ? "Metrics aren't available for your account yet"
    : error
      ? "Couldn't load regional traffic"
      : loading
        ? 'Finding regions…'
        : rows.length === 0
          ? 'No locations found'
          : `${activeCount} of ${rows.length} ${rows.length === 1 ? 'region' : 'regions'} serving traffic`;

  const surface = [styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }];

  return (
    <View style={styles.root}>
      <Text size="xs" tone="muted" style={styles.caption} accessibilityLiveRegion="polite">
        {caption}
      </Text>
      {unavailable || error ? null : loading ? (
        <View style={surface} accessibilityLabel="Loading regions">
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.row, i > 0 && divider(t.colors.border)]}>
              <Skeleton width={8} height={8} radius={4} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width={96} height={14} />
                <Skeleton width={140} height={11} />
              </View>
              <Skeleton width={64} height={14} />
            </View>
          ))}
        </View>
      ) : rows.length > 0 && activeCount === 0 ? (
        <View style={[surface, styles.empty]}>
          <Text size="sm" weight="medium">
            No traffic yet
          </Text>
          <Text size="xs" tone="muted" style={{ textAlign: 'center' }}>
            {`${rows.length} ${rows.length === 1 ? 'region is' : 'regions are'} ready to serve ` +
              'as soon as requests arrive.'}
          </Text>
        </View>
      ) : rows.length > 0 ? (
        <Animated.View entering={FadeIn.duration(250)} style={surface}>
          {rows.map((row, i) => (
            <RegionRowView key={row.key} row={row} first={i === 0} />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

function RegionRowView({ row, first }: { row: RegionRow; first: boolean }) {
  const t = useDatumTheme();
  const detail = row.active ? formatRegionDetail(row) : '';
  const rps = formatRegionRps(row.rps);
  return (
    <View
      style={[styles.row, !first && divider(t.colors.border)]}
      accessible
      accessibilityLabel={[row.region, row.place, row.active ? rps : 'Idle', detail].filter(Boolean).join(', ')}>
      <View style={[styles.dot, { backgroundColor: row.active ? t.colors.success : t.colors.border }]} />
      <View style={styles.name}>
        <Text size="sm" weight="medium" numberOfLines={1}>
          {row.region}
        </Text>
        {row.place ? (
          <Text size="xs" tone="muted" numberOfLines={1}>
            {row.place}
          </Text>
        ) : null}
      </View>
      <View style={styles.stats}>
        {row.active ? (
          <>
            <Text size="sm" weight="semibold" numberOfLines={1} style={styles.tabular}>
              {rps}
            </Text>
            {detail ? (
              <Text size="xs" tone="muted" numberOfLines={1} style={styles.tabular}>
                {detail}
              </Text>
            ) : null}
            <View style={[styles.track, { backgroundColor: t.colors.muted }]}>
              <View
                style={[
                  styles.bar,
                  { backgroundColor: t.colors.primary, width: `${Math.max(row.share * 100, 4)}%` },
                ]}
              />
            </View>
          </>
        ) : (
          <Text size="xs" tone="muted">
            Idle
          </Text>
        )}
      </View>
    </View>
  );
}

const divider = (color: string) => ({ borderTopColor: color, borderTopWidth: StyleSheet.hairlineWidth });

const styles = StyleSheet.create({
  root: { gap: 8 },
  caption: { paddingHorizontal: 4 },
  card: {
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 20, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, minWidth: 0, gap: 2 },
  stats: { alignItems: 'flex-end', gap: 2, maxWidth: '55%' },
  tabular: { fontVariant: ['tabular-nums'] },
  track: { width: 72, height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 3 },
  bar: { height: 3, borderRadius: 2 },
});
