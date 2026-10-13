import { datumFonts, DatumThemeProvider, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { NavigationTheme } from '@/components/NavigationTheme';
import { ProjectContextProvider, useProjectContext } from '@/context/ProjectContext';
import { useDevRouteScript } from '@/dev/useDevRouteScript';
import {
  clearQueryCache,
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  queryClient,
  queryPersister,
  shouldPersistQuery,
  wireAppStateFocus,
} from '@/lib/query';

// Keep the native splash up until the JS splash has painted an identical frame.
void SplashScreen.preventAutoHideAsync();

export { ErrorBoundary } from 'expo-router';

function RootStack() {
  const { state, emailNotVerified } = useAuth();
  const t = useDatumTheme();
  const signedIn = state.status === 'signedIn';
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.background },
        animation: 'fade',
      }}>
      <Stack.Protected guard={!signedIn || emailNotVerified}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !emailNotVerified}>
        <Stack.Screen name="(app)" />
        {/* Patch, the assistant: presented over the tabs from Home and "Ask Patch about this". */}
        <Stack.Screen
          name="assistant"
          options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'default' }}
        />
        <Stack.Screen
          name="context-switcher"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.7, 1],
            sheetGrabberVisible: true,
            headerShown: false,
            animation: 'default',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack.Protected>
      <Stack.Screen name="index" />
      <Stack.Screen name="oauth" />
    </Stack>
  );
}

/** Drops the persisted query cache when a different user signs in or someone signs out. */
function CacheOwnerGuard() {
  const { state } = useAuth();
  const owner = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (state.status === 'loading') return;
    const sub = state.status === 'signedIn' ? state.user.sub : null;
    if (owner.current !== undefined && owner.current !== sub) void clearQueryCache();
    owner.current = sub;
  }, [state]);
  return null;
}

function SplashGate({ cacheRestored }: { cacheRestored: boolean }) {
  const { state } = useAuth();
  const { hydrated } = useProjectContext();
  const [done, setDone] = useState(false);
  const ready = state.status !== 'loading' && hydrated && cacheRestored;
  const onDone = useCallback(() => setDone(true), []);
  useDevRouteScript(done && state.status === 'signedIn');
  if (done) return null;
  return <AnimatedSplash ready={ready} onDone={onDone} />;
}

export default function RootLayout() {
  const [cacheRestored, setCacheRestored] = useState(false);
  // Fonts are embedded at build time (expo-font config plugin), so on iOS this
  // resolves immediately; it only does real work where they aren't embedded.
  useFonts(datumFonts);
  useEffect(() => wireAppStateFocus(), []);
  return (
    <DatumThemeProvider scheme="system">
      <AuthProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: PERSIST_MAX_AGE_MS,
            buster: PERSIST_BUSTER,
            dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
          }}
          onSuccess={() => setCacheRestored(true)}
          onError={() => setCacheRestored(true)}>
          <ProjectContextProvider>
            <NavigationTheme>
              <StatusBar style="auto" />
              <CacheOwnerGuard />
              <RootStack />
              <SplashGate cacheRestored={cacheRestored} />
            </NavigationTheme>
          </ProjectContextProvider>
        </PersistQueryClientProvider>
      </AuthProvider>
    </DatumThemeProvider>
  );
}
