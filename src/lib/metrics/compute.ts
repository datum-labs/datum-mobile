// Ported from compute ui/consumer/src/lib/metrics-queries.ts at 285fb19d. CPU and memory
// series are `datum_compute_instance_*`, federated into the portal VictoriaMetrics with the
// project label; `resource_name` is the Instance's metadata.name. There is no workload label,
// so a workload is the same selector over every instance name we already have from the API.
// The compute UI's workload page sums across instances (workloadCpuSumQuery,
// workloadMemorySumQuery), so the app does too.

export const CPU_METRIC = 'datum_compute_instance_cpu_usage_seconds_total';
export const MEMORY_METRIC = 'datum_compute_instance_memory_working_set_bytes';

/** The label that pins a series to an Instance (compute `INSTANCE_IDENTITY_LABELS`). */
export const INSTANCE_IDENTITY_LABEL = 'resource_name';

function escapePromQL(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapePromQLRegexp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `label="a"` for one name, `label=~"a|b"` for several, undefined for none. */
export function namesMatcher(label: string, names: readonly string[]): string | undefined {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return undefined;
  if (unique.length === 1) return `${label}="${escapePromQL(unique[0])}"`;
  return `${label}=~"${unique.map(escapePromQLRegexp).join('|')}"`;
}

export function instanceSelector(projectId: string, instance: string): string {
  return `{resourcemanager_datumapis_com_project_name="${escapePromQL(projectId)}",${INSTANCE_IDENTITY_LABEL}="${escapePromQL(instance)}"}`;
}

export function scopedInstanceSelector(projectId: string, names: readonly string[]): string | undefined {
  const match = namesMatcher(INSTANCE_IDENTITY_LABEL, names);
  if (!match) return undefined;
  return `{resourcemanager_datumapis_com_project_name="${escapePromQL(projectId)}",${match}}`;
}

/** Cores in use (rate of CPU-seconds). */
export function cpuUsageQuery(projectId: string, instance: string): string {
  return `sum(rate(${CPU_METRIC}${instanceSelector(projectId, instance)}[2m]))`;
}

/** Working-set bytes. */
export function memoryUsageQuery(projectId: string, instance: string): string {
  return `sum(${MEMORY_METRIC}${instanceSelector(projectId, instance)})`;
}

export function workloadCpuSumQuery(projectId: string, names: readonly string[]): string | undefined {
  const selector = scopedInstanceSelector(projectId, names);
  return selector ? `sum(rate(${CPU_METRIC}${selector}[2m]))` : undefined;
}

export function workloadMemorySumQuery(projectId: string, names: readonly string[]): string | undefined {
  const selector = scopedInstanceSelector(projectId, names);
  return selector ? `sum(${MEMORY_METRIC}${selector})` : undefined;
}
