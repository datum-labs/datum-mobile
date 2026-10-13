import { router, Stack, useLocalSearchParams } from 'expo-router';

import { ConnectDeviceSection } from '@/components/ConnectDeviceSection';
import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
import { useNetwork } from '@/resources/networks/queries';

export default function NetworkDetail() {
  // `connect=1`: just created from New Network; join this iPhone once it's Ready.
  const { id, connect } = useLocalSearchParams<{ id: string; connect?: string }>();
  const projectId = useProjectId();
  const query = useNetwork(projectId, id);
  const network = query.data;

  return (
    <>
      <Stack.Screen options={{ title: network?.displayName ?? 'Network' }} />
      <Screen onRefresh={() => query.refetch()}>
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
            {projectId ? (
              <ConnectDeviceSection
                project={projectId}
                network={network.name}
                displayName={network.displayName}
                networkReady={!!network.ipv6Prefix}
                autoConnect={connect === '1'}
                onAutoConnectStarted={() => router.setParams({ connect: undefined })}
              />
            ) : null}
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
            <Section title="Conditions">
              <ConditionsCard conditions={network.conditions} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
