import { datumFonts, DatumThemeProvider, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { Platform } from 'react-native';
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
// Defines the widgets' background refresh task at startup (a no-op without its native modules).
import { cancelWidgetRefresh } from '@/resources/widgets/background';
import { clearHealth } from '@/resources/widgets/service';
import { preloadToolbarIcons } from '@/lib/icons/toolbar';

// Keep the native splash up until the JS splash has painted an identical frame.
void SplashScreen.preventAutoHideAsync();

export { ErrorBoundary } from 'expo-router';

/** iOS form sheets get the system Liquid Glass; Android sheets need a surface. */
const SHEET_BACKGROUND = (t: ReturnType<typeof useDatumTheme>) =>
  Platform.OS === 'ios' ? 'transparent' : t.colors.background;

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
        // Portrait everywhere; nested stacks and tabs inherit it. Only the shell turns.
        orientation: 'portrait',
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
        {/* Instance shell: presented over the tabs from an instance's "Open shell". */}
        <Stack.Screen
          name="console"
          options={{
            presentation: 'fullScreenModal',
            headerShown: false,
            animation: 'default',
            // Portrait or either landscape (not upside down), for a wider terminal.
            orientation: 'default',
          }}
        />
        <Stack.Screen
          name="context-switcher"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.7, 1],
            sheetGrabberVisible: true,
            headerShown: false,
            animation: 'default',
            contentStyle: { backgroundColor: SHEET_BACKGROUND(t) },
          }}
        />
        {/* Create a private network: from Home and the Network tab. */}
        <Stack.Screen
          name="new-network"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.75, 1],
            sheetGrabberVisible: true,
            headerShown: true,
            headerTransparent: true,
            headerShadowVisible: false,
            animation: 'default',
            contentStyle: { backgroundColor: SHEET_BACKGROUND(t) },
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
    if (owner.current !== undefined && owner.current !== sub) {
      void clearQueryCache();
      // The widgets mustn't keep showing the previous user's projects.
      void clearHealth();
      if (!sub) void cancelWidgetRefresh();
    }
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

// Android header icons are Material Symbols rendered to images; start now (see lib/icons/toolbar).
preloadToolbarIcons();

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
