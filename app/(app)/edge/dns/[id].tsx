import { Card, CardContent, StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, QueryView, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { pluralize } from '@/lib/format';
import type { DnsRecord } from '@/resources/dns/service';
import { useDnsRecords, useDnsZone } from '@/resources/dns/queries';

function RecordRow({ record, last }: { record: DnsRecord; last: boolean }) {
  const t = useDatumTheme();
  return (
    <View
      style={[
        styles.record,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.cardBorder },
      ]}>
      <View style={styles.recordHead}>
        <View style={[styles.type, { backgroundColor: t.colors.accent }]}>
          <Text size="xs" weight="semibold" mono>
            {record.type}
          </Text>
        </View>
        <Text size="sm" weight="medium" mono numberOfLines={1} style={{ flex: 1 }} selectable>
          {record.name}
        </Text>
        {record.view.status !== 'success' ? (
          <StatusBadge status={record.view.status} label={record.view.label} />
        ) : null}
      </View>
      <Text size="xs" tone="muted" mono selectable numberOfLines={4}>
        {record.value}
        {record.ttl !== undefined ? `  · TTL ${record.ttl}` : ''}
      </Text>
      {record.view.detail && record.view.status !== 'success' ? (
        <Text size="xs" tone="warning">
          {record.view.detail}
        </Text>
      ) : null}
    </View>
  );
}

export default function DnsZoneDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const zoneQuery = useDnsZone(projectId, id);
  const records = useDnsRecords(projectId, id);
  const zone = zoneQuery.data;

  return (
    <>
      <Stack.Screen options={{ title: zone?.domainName ?? 'DNS zone' }} />
      <Screen onRefresh={() => Promise.all([zoneQuery.refetch(), records.refetch()])}>
        {!zone ? (
          zoneQuery.error ? (
            <ErrorState error={zoneQuery.error} onRetry={() => void zoneQuery.refetch()} />
          ) : (
            <RowSkeletons count={3} />
          )
        ) : (
          <>
            <DetailHeader icon="list.bullet.rectangle" title={zone.domainName} status={zone.view} />
            <Section title="Nameservers">
              <InfoCard
                rows={zone.nameservers.map((ns, i) => ({ label: `NS ${i + 1}`, value: ns, mono: true }))}
              />
              {zone.nameservers.length === 0 ? (
                <Text size="sm" tone="muted">
                  Nameservers are assigned once the zone is ready.
                </Text>
              ) : null}
            </Section>
            <Section
              title={records.data ? `Records · ${pluralize(records.data.length, 'record')}` : 'Records'}>
              <QueryView
                query={records}
                isEmpty={(d) => d.length === 0}
                empty={{ title: 'No records', description: 'This zone has no record sets yet.' }}>
                {(rows) => (
                  <Animated.View entering={FadeIn.duration(250)}>
                    <Card size="sm" sectioned>
                      <CardContent padding="none">
                        {rows.map((record, i) => (
                          <RecordRow key={record.key} record={record} last={i === rows.length - 1} />
                        ))}
                      </CardContent>
                    </Card>
                  </Animated.View>
                )}
              </QueryView>
            </Section>
            <Section title="Conditions">
              <ConditionsCard conditions={zone.conditions} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  record: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  recordHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  type: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, minWidth: 44, alignItems: 'center' },
});
