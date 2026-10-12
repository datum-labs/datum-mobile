import { Stack, useLocalSearchParams } from 'expo-router';

import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
import { useNetwork, useSubnets } from '@/resources/networks/queries';

export default function NetworkDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const query = useNetwork(projectId, id);
  const subnets = useSubnets(projectId);
  const network = query.data;
  const own = (subnets.data ?? []).filter((s) => s.network === id);

  return (
    <>
      <Stack.Screen options={{ title: network?.displayName ?? 'Network', headerLargeTitle: false }} />
      <Screen onRefresh={() => Promise.all([query.refetch(), subnets.refetch()])}>
        {!network ? (
          query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <RowSkeletons count={3} />
          )
        ) : (
          <>
            <DetailHeader
              icon="point.3.filled.connected.trianglepath.dotted"
              title={network.displayName}
              subtitle={network.name !== network.displayName ? network.name : undefined}
              status={network.view}
            />
            <Section title="Addressing">
              <InfoCard
                rows={[
                  { label: 'IPAM mode', value: network.ipamMode },
                  { label: 'IP families', value: network.ipFamilies.join(', ') },
                  { label: 'IPv4 range', value: network.ipv4Range, mono: true },
                  { label: 'IPv6 range', value: network.ipv6Range, mono: true },
                  { label: 'IPv6 prefix', value: network.ipv6Prefix, mono: true },
                  { label: 'MTU', value: network.mtu },
                  { label: 'Created', value: formatDate(network.createdAt) },
                ]}
              />
            </Section>
            {own.length > 0 ? (
              <Section title="Subnets">
                {own.map((s, i) => (
                  <ResourceRow
                    key={s.uid}
                    index={i}
                    icon="square.split.bottomrightquarter"
                    title={s.cidr ?? s.name}
                    subtitle={[s.location, s.subnetClass].filter(Boolean).join(' · ')}
                    status={s.view}
                  />
                ))}
              </Section>
            ) : null}
            <Section title="Conditions">
              <ConditionsCard conditions={network.conditions} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
