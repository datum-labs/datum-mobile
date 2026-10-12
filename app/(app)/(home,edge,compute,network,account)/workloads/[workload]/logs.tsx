import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ConsoleLogsScreen } from '@/components/ConsoleLogsScreen';
import { useProjectId } from '@/context/ProjectContext';
import { useWorkloadInstances } from '@/resources/compute/queries';

/** Console output from every instance of a workload, merged newest first. */
export default function WorkloadLogs() {
  const { workload } = useLocalSearchParams<{ workload: string }>();
  const projectId = useProjectId();
  const instances = useWorkloadInstances(projectId, workload);
  const names = useMemo(() => instances.data?.map((instance) => instance.name), [instances.data]);
  return (
    <ConsoleLogsScreen
      title="Logs"
      context={workload}
      workloadName={workload}
      instanceNames={names}
      instancesError={instances.error}
      onRefreshInstances={() => instances.refetch()}
    />
  );
}
