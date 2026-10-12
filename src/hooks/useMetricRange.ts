import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DEFAULT_METRIC_RANGE, isMetricRangeKey, type MetricRangeKey } from '@/lib/metrics';

/**
 * Time range for a metrics screen, limited to `allowed`. `?range=24h` seeds
 * it, so links (and the dev route script) can open a screen on a window.
 */
export function useMetricRange(allowed: readonly MetricRangeKey[], fallback: MetricRangeKey = DEFAULT_METRIC_RANGE) {
  const params = useLocalSearchParams<{ range?: string }>();
  const seeded = isMetricRangeKey(params.range) && allowed.includes(params.range) ? params.range : fallback;
  const [range, setRange] = useState<MetricRangeKey>(seeded);
  return { range, setRange, allowed };
}

export type MetricRangeControl = ReturnType<typeof useMetricRange>;
