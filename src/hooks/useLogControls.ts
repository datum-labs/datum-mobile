import { useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useState } from 'react';

import { DEFAULT_LOG_RANGE, isLogRangeKey, type LogRangeKey } from '@/lib/logs';

/**
 * Time range, live and search state for a log screen. `?range=24h` and
 * `?live=1` seed it, so links (and the dev route script) can open a screen
 * on a given window.
 */
export function useLogControls() {
  const params = useLocalSearchParams<{ range?: string; live?: string }>();
  const [range, setRange] = useState<LogRangeKey>(isLogRangeKey(params.range) ? params.range : DEFAULT_LOG_RANGE);
  const [live, setLive] = useState(params.live === '1');
  const [searchText, setSearch] = useState('');
  // Typing stays responsive while 500 rows re-filter.
  const search = useDeferredValue(searchText);
  return { range, setRange, live, setLive, search, setSearch };
}

export type LogControls = ReturnType<typeof useLogControls>;
