import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

/** AsyncStorage key holding `route|route|…` to replay once at launch. */
export const DEV_ROUTE_KEY = 'datum.dev.routeScript';

/**
 * DEV ONLY: replay a list of routes once after launch, so screenshots and
 * smoke checks can be driven on a simulator without taps (simctl openurl
 * shows an "Open in…?" prompt that can't be dismissed headlessly). The
 * whole hook body is behind `__DEV__` and folds away in release bundles.
 */
export function useDevRouteScript(ready: boolean) {
  useEffect(() => {
    if (!__DEV__ || !ready) return;
    let cancelled = false;
    void (async () => {
      const script = await AsyncStorage.getItem(DEV_ROUTE_KEY).catch(() => null);
      if (!script) return;
      await AsyncStorage.removeItem(DEV_ROUTE_KEY).catch(() => undefined);
      for (const route of script.split('|').filter(Boolean)) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        if (cancelled) return;
        router.push(route as Href);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);
}
