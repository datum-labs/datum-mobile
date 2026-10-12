import { Stack } from 'expo-router';
import { View } from 'react-native';

import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { NoProjectState, QueryView } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { useSegment } from '@/hooks/useSegment';
import { instanceView, workloadView } from '@/lib/status/views';
import { imageShortName } from '@/lib/status/workload';
import { useInstances, useWorkloads } from '@/resources/compute/queries';

const SEGMENTS = [
  { value: 'workloads', label: 'Workloads' },
  { value: 'instances', label: 'Instances' },
] as const;
type Segment = (typeof SEGMENTS)[number]['value'];

export default function ComputeIndex() {
  const projectId = useProjectId();
  const [segment, setSegment] = useSegment<Segment>(
    SEGMENTS.map((s) => s.value),
    'workloads'
  );
  const workloads = useWorkloads(projectId);
  const instances = useInstances(projectId);

  return (
    <>
      <Stack.Screen options={{ title: 'Compute' }} />
      <Screen
        onRefresh={
          projectId
            ? () => (segment === 'workloads' ? workloads.refetch() : instances.refetch())
            : undefined
        }>
        <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
        {!projectId ? (
          <NoProjectState />
        ) : segment === 'workloads' ? (
          <QueryView
            query={workloads}
            isEmpty={(d) => d.length === 0}
            empty={{
              title: 'No workloads yet',
              description: 'Workloads you deploy to this project show up here.',
            }}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((w, i) => (
                  <ResourceRow
                    key={w.uid}
                    index={i}
                    icon="shippingbox.fill"
                    title={w.name}
                    subtitle={[
                      w.desiredReplicas > 0 ? `${w.readyReplicas}/${w.desiredReplicas} ready` : undefined,
                      w.locations.length ? w.locations.join(', ') : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    meta={imageShortName(w.image)}
                    status={workloadView(w)}
                    href={`/compute/${encodeURIComponent(w.name)}`}
                  />
                ))}
              </View>
            )}
          </QueryView>
        ) : (
          <QueryView
            query={instances}
            isEmpty={(d) => d.length === 0}
            empty={{ title: 'No instances', description: 'Instances appear once a workload is placed.' }}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((inst, i) => (
                  <ResourceRow
                    key={inst.uid}
                    index={i}
                    icon="cpu"
                    title={inst.name}
                    subtitle={[inst.workloadName, inst.location].filter(Boolean).join(' · ')}
                    meta={inst.externalIP ?? inst.internalIP}
                    status={instanceView(inst)}
                    href={`/compute/instances/${encodeURIComponent(inst.name)}`}
                  />
                ))}
              </View>
            )}
          </QueryView>
        )}
      </Screen>
    </>
  );
}
