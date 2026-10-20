import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';

import { ASK_PATCH, askPatchAbout } from '@/components/assistant/askPatch';
import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { RowGroup } from '@/components/Grouped';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
import { instanceView } from '@/lib/status/views';
import { useInstance } from '@/resources/compute/queries';
import { useShellAvailable } from '@/resources/console/queries';
import { toConditions } from '@/resources/shared';
import { useToolbarIcon } from '@/lib/icons/toolbar';

export default function InstanceDetail() {
  const toolbarIcon = useToolbarIcon();
  const { instance: name } = useLocalSearchParams<{ instance: string }>();
  const projectId = useProjectId();
  const query = useInstance(projectId, name);
  const instance = query.data;
  const canOpenShell = useShellAvailable(projectId, instance) === true;

  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Instance' }} />
      {name ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={toolbarIcon('terminal')}
            accessibilityLabel="Open shell"
            hidden={!canOpenShell}
            onPress={() =>
              router.push({ pathname: '/console/[instance]', params: { instance: name } } as Href)
            }
          />
          <Stack.Toolbar.Button {...ASK_PATCH} onPress={() => askPatchAbout('instance', name)} />
        </Stack.Toolbar>
      ) : null}
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
            <Section title="Observability">
              <RowGroup>
              <ResourceRow
                icon="chart.xyaxis.line"
                title="Metrics"
                subtitle="CPU and memory"
                href={`/instances/${encodeURIComponent(instance.name)}/metrics`}
              />
              <ResourceRow
                index={1}
                icon="doc.text.magnifyingglass"
                title="Logs"
                subtitle="Console output from this instance"
                href={`/instances/${encodeURIComponent(instance.name)}/logs`}
              />
              </RowGroup>
            </Section>
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
