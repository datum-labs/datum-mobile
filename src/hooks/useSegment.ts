import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

/** Segmented-control state that also follows a `?segment=` deep link (e.g. from Home tiles). */
export function useSegment<T extends string>(allowed: readonly T[], fallback: T) {
  const { segment } = useLocalSearchParams<{ segment?: string }>();
  const fromParam = allowed.find((value) => value === segment);
  const [state, setState] = useState<{ param?: T; value: T }>({
    param: fromParam,
    value: fromParam ?? fallback,
  });
  // A new deep-link param wins over the local choice (adjusting state during render).
  if (fromParam && fromParam !== state.param) {
    setState({ param: fromParam, value: fromParam });
  }
  const setValue = (value: T) => setState((prev) => ({ ...prev, value }));
  return [state.value, setValue] as const;
}
