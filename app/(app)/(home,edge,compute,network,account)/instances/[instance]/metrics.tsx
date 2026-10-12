import { useLocalSearchParams } from 'expo-router';

import { ComputeMetricsScreen } from '@/components/ComputeMetricsScreen';
import { useProjectId } from '@/context/ProjectContext';
import { cpuUsageQuery, memoryUsageQuery } from '@/lib/metrics';

/** CPU and memory for one instance (compute UI `cpuUsageQuery` / `memoryUsageQuery`). */
export default function InstanceMetrics() {
  const { instance } = useLocalSearchParams<{ instance: string }>();
  const projectId = useProjectId();
  const queries =
    projectId && instance
      ? { cpu: cpuUsageQuery(projectId, instance), memory: memoryUsageQuery(projectId, instance) }
      : undefined;
  return <ComputeMetricsScreen context={instance} queries={queries} />;
}
