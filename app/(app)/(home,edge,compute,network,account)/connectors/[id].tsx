import {  } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
import { useConnector } from '@/resources/connectors/queries';
import { StatusLabel } from '@/components/Grouped';

export default function ConnectorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const query = useConnector(projectId, id);
  const connector = query.data;

  return (
    <>
      <Stack.Screen
        options={{ title: connector?.deviceName ?? connector?.name ?? 'Connector' }}
      />
      <Screen onRefresh={() => query.refetch()}>
        {!connector ? (
          query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <RowSkeletons count={3} />
          )
        ) : (
          <>
            <DetailHeader
              icon="cable.connector"
              title={connector.deviceName ?? connector.name}
              subtitle={connector.deviceName ? connector.name : undefined}
              status={connector.view}
            />
            <Section title="Device">
              <InfoCard
                rows={[
                  { label: 'Operating system', value: connector.deviceOs },
                  { label: 'Connector class', value: connector.className },
                  { label: 'Home relay', value: connector.homeRelay, mono: true },
                  {
                    label: 'Addresses',
                    value: connector.addresses.length ? connector.addresses.join('\n') : undefined,
                    mono: true,
                  },
                  { label: 'Lease', value: connector.leaseName, mono: true },
                  { label: 'Created', value: formatDate(connector.createdAt) },
                ]}
              />
            </Section>
            {connector.capabilities.length > 0 ? (
              <Section title="Capabilities">
                <InfoCard
                  rows={connector.capabilities.map((cap) => ({
                    label: cap.type,
                    value: <StatusLabel status={cap.view.status} label={cap.enabled ? cap.view.label : 'Disabled'} />,
                  }))}
                />
              </Section>
            ) : null}
            <Section title="Conditions">
              <ConditionsCard conditions={connector.conditions} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
