import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ComputeMetricsScreen } from '@/components/ComputeMetricsScreen';
import { useProjectId } from '@/context/ProjectContext';
import { workloadCpuSumQuery, workloadMemorySumQuery } from '@/lib/metrics';
import { useWorkloadInstances } from '@/resources/compute/queries';

/**
 * CPU and memory summed over every instance of a workload, as the compute
 * UI's workload page does (`workloadCpuSumQuery` / `workloadMemorySumQuery`).
 */
export default function WorkloadMetrics() {
  const { workload } = useLocalSearchParams<{ workload: string }>();
  const projectId = useProjectId();
  const instances = useWorkloadInstances(projectId, workload);
  const names = useMemo(() => instances.data?.map((instance) => instance.name), [instances.data]);
  const queries =
    projectId && names && names.length > 0
      ? { cpu: workloadCpuSumQuery(projectId, names), memory: workloadMemorySumQuery(projectId, names) }
      : undefined;
  return (
    <ComputeMetricsScreen
      context={workload}
      queries={queries}
      instanceCount={names?.length}
      instancesError={instances.error}
      onRefreshInstances={() => instances.refetch()}
    />
  );
}
