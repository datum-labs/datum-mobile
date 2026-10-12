import { Stack, useLocalSearchParams } from 'expo-router';

import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
import { instanceView } from '@/lib/status/views';
import { useInstance } from '@/resources/compute/queries';
import { toConditions } from '@/resources/shared';

export default function InstanceDetail() {
  const { instance: name } = useLocalSearchParams<{ instance: string }>();
  const projectId = useProjectId();
  const query = useInstance(projectId, name);
  const instance = query.data;

  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Instance' }} />
      <Screen onRefresh={() => query.refetch()}>
        {!instance ? (
          query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <RowSkeletons count={3} />
          )
        ) : (
          <>
            <DetailHeader
              icon="cpu"
              title={instance.name}
              subtitle={instance.image}
              status={instanceView(instance)}
            />
            <Section title="Placement">
              <InfoCard
                rows={[
                  { label: 'Workload', value: instance.workloadName },
                  { label: 'Location', value: instance.location },
                  { label: 'Placement', value: instance.placement },
                ]}
              />
            </Section>
            <Section title="Resources">
              <InfoCard
                rows={[
                  { label: 'Instance type', value: instance.instanceType, mono: true },
                  { label: 'vCPU', value: instance.cpu },
                  { label: 'Memory', value: instance.memory },
                  { label: 'Runtime class', value: instance.runtimeClass },
                  { label: 'Containers', value: instance.containers.join(', ') },
                  { label: 'Ports', value: instance.ports.join(', '), mono: true },
                ]}
              />
            </Section>
            <Section title="Network">
              <InfoCard
                rows={[
                  { label: 'External IP', value: instance.externalIP, mono: true },
                  { label: 'Internal IP', value: instance.internalIP, mono: true },
                  {
                    label: 'Host IPs',
                    value: instance.internalIPs.length ? instance.internalIPs.join('\n') : undefined,
                    mono: true,
                  },
                ]}
              />
            </Section>
            <Section title="Details">
              <InfoCard rows={[{ label: 'Created', value: formatDate(instance.createdAt) }]} />
            </Section>
            <Section title="Conditions">
              <ConditionsCard conditions={toConditions(instance.conditions)} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
