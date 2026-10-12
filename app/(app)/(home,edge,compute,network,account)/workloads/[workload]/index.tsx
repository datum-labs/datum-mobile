import { Card, CardContent, StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
import { instanceView, workloadAlbView, workloadView } from '@/lib/status/views';
import { instanceFailureSummary, regionLabel } from '@/lib/status/workload';
import {
  useWorkload,
  useWorkloadAlbs,
  useWorkloadDeployments,
  useWorkloadInstances,
} from '@/resources/compute/queries';
import { toConditions } from '@/resources/shared';

const HEALTH_STATUS = {
  Available: 'success',
  Degraded: 'pending',
  Deploying: 'pending',
  Unavailable: 'error',
  Unknown: 'unknown',
} as const;

export default function WorkloadDetail() {
  const t = useDatumTheme();
  const { workload: name } = useLocalSearchParams<{ workload: string }>();
  const projectId = useProjectId();
  const query = useWorkload(projectId, name);
  const deployments = useWorkloadDeployments(projectId, name);
  const instances = useWorkloadInstances(projectId, name);
  const albs = useWorkloadAlbs(projectId, name);
  const workload = query.data;
  const serving = (workload?.readyReplicas ?? 0) > 0;
  const failure = instances.data ? instanceFailureSummary(instances.data) : undefined;

  return (
    <>
      <Stack.Screen options={{ title: name ?? 'Workload' }} />
      <Screen
        onRefresh={() =>
          Promise.all([query.refetch(), deployments.refetch(), instances.refetch(), albs.refetch()])
        }>
        {!workload ? (
          query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <RowSkeletons count={4} />
          )
        ) : (
          <>
            <DetailHeader
              icon="shippingbox.fill"
              title={workload.name}
              subtitle={workload.image}
              status={workloadView(workload)}>
              {failure ? (
                <Text size="xs" tone="destructive">
                  {failure}
                </Text>
              ) : null}
            </DetailHeader>

            {albs.data && albs.data.length > 0 ? (
              <Section title="Load balancer">
                {albs.data.map((alb, i) => (
                  <ResourceRow
                    key={alb.proxyName}
                    index={i}
                    icon="arrow.triangle.branch"
                    title={alb.displayName}
                    meta={alb.hostname}
                    status={workloadAlbView(alb, serving)}
                    href={`/alb/${encodeURIComponent(alb.proxyName)}`}
                  />
                ))}
              </Section>
            ) : null}

            {workload.placementRegions.length > 0 ? (
              <Section title="Placements">
                <Card size="sm" sectioned>
                  <CardContent padding="none">
                    {workload.placementRegions.map((region, i) => (
                      <View
                        key={region.name}
                        style={[
                          styles.region,
                          i < workload.placementRegions.length - 1 && {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: t.colors.cardBorder,
                          },
                        ]}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text size="sm" weight="medium">
                            {region.name}
                          </Text>
                          <Text size="xs" tone="muted" numberOfLines={2}>
                            {regionLabel(region)}
                          </Text>
                        </View>
                        <Text size="sm" mono>
                          {region.readyReplicas}/{region.desiredReplicas}
                        </Text>
                        <StatusBadge status={HEALTH_STATUS[region.health]} label={region.health} />
                      </View>
                    ))}
                  </CardContent>
                </Card>
              </Section>
            ) : null}

            {deployments.data && deployments.data.length > 0 ? (
              <Section title="Deployments">
                {deployments.data.map((d, i) => (
                  <ResourceRow
                    key={d.uid}
                    index={i}
                    icon="square.stack.3d.down.right"
                    title={d.location ?? d.cityCode ?? d.name}
                    subtitle={[d.placement, `${d.currentReplicas}/${d.desiredReplicas} replicas`]
                      .filter(Boolean)
                      .join(' · ')}
                    status={d.view}
                  />
                ))}
              </Section>
            ) : null}

            <Section title="Logs">
              <ResourceRow
                icon="doc.text.magnifyingglass"
                title="Logs"
                subtitle={
                  instances.data && instances.data.length > 1
                    ? `Console output from all ${instances.data.length} instances`
                    : 'Console output from this workload'
                }
                href={`/workloads/${encodeURIComponent(workload.name)}/logs`}
              />
            </Section>

            <Section title="Instances">
              {instances.data ? (
                instances.data.length === 0 ? (
                  <Text size="sm" tone="muted">
                    No instances yet.
                  </Text>
                ) : (
                  instances.data.map((inst, i) => (
                    <ResourceRow
                      key={inst.uid}
                      index={i}
                      icon="cpu"
                      title={inst.name}
                      subtitle={inst.location}
                      meta={inst.externalIP ?? inst.internalIP}
                      status={instanceView(inst)}
                      href={`/instances/${encodeURIComponent(inst.name)}`}
                    />
                  ))
                )
              ) : instances.error ? (
                <ErrorState error={instances.error} onRetry={() => void instances.refetch()} />
              ) : (
                <RowSkeletons count={2} />
              )}
            </Section>

            <Section title="Details">
              <InfoCard
                rows={[
                  { label: 'Runtime', value: workload.runtimeType },
                  { label: 'Resources', value: workload.resources },
                  { label: 'Ports', value: workload.ports.join(', '), mono: true },
                  { label: 'Networks', value: workload.networks.join(', ') },
                  {
                    label: 'Replicas',
                    value: `${workload.readyReplicas} ready of ${workload.desiredReplicas}`,
                  },
                  { label: 'Created', value: formatDate(workload.createdAt) },
                ]}
              />
            </Section>

            <Section title="Conditions">
              <ConditionsCard conditions={toConditions(workload.conditions)} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  region: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
