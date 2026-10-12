import { Alert, LogoFlat, Text, Title, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { isDevTokenAllowed } from '@/auth/dev-token';
import { GlassButton } from '@/components/GlassButton';
import { Icon } from '@/components/Icon';

const NAVY = '#0c1d31';
const hero = require('@/assets/images/hero-portrait.jpg');

export default function Welcome() {
  const t = useDatumTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { signIn, configError, notice } = useAuth();
  const [busy, setBusy] = useState<'signin' | 'switch' | null>(null);
  const [error, setError] = useState<string | undefined>();

  const run = async (selectAccount: boolean) => {
    setError(undefined);
    setBusy(selectAccount ? 'switch' : 'signin');
    const result = await signIn({ selectAccount });
    setBusy(null);
    if (result.type === 'error') setError(result.message);
  };

  return (
    // The welcome screen is always dark: it sits on the night-sky illustration.
    <View style={[styles.root, { backgroundColor: NAVY }]}>
      <Animated.View entering={FadeIn.duration(500)} style={StyleSheet.absoluteFill}>
        <Image source={hero} style={{ width, height }} contentFit="cover" transition={0} />
        <LinearGradient
          colors={[NAVY, 'rgba(12,29,49,0)', 'rgba(12,29,49,0.25)', 'rgba(12,29,49,0.92)']}
          locations={[0.12, 0.42, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={[styles.top, { paddingTop: insets.top + 36 }]}>
        <Animated.View entering={FadeInDown.delay(120).duration(500)}>
          <LogoFlat height={30} tone="mono-light" />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(220).duration(500)} style={{ gap: 10 }}>
          <Title level={1} style={{ color: '#f6f6f5' }}>
            Your cloud,{'\n'}within reach.
          </Title>
          <Text size="base" style={{ color: 'rgba(246,246,245,0.75)', maxWidth: 300 }}>
            Check on load balancers, workloads, networks and DNS across your Datum Cloud projects.
          </Text>
        </Animated.View>
      </View>

      <Animated.View
        entering={FadeInDown.delay(360).duration(500)}
        style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]}>
        {configError ? (
          <Alert
            type="warning"
            title="Sign-in isn't configured"
            description={configError}
            icon={<Icon name="wrench.and.screwdriver.fill" size={15} />}
          />
        ) : null}
        {notice || error ? (
          <Alert
            type={error ? 'destructive' : 'info'}
            title={error ? "Couldn't sign in" : notice}
            description={error}
          />
        ) : null}
        <GlassButton
          label="Sign in with Datum"
          icon="person.crop.circle.fill"
          onPress={() => void run(false)}
          loading={busy === 'signin'}
          disabled={!!configError || busy !== null}
          testID="sign-in"
        />
        <Text
          size="sm"
          weight="medium"
          style={styles.link}
          onPress={() => (busy || configError ? undefined : void run(true))}
          accessibilityRole="button">
          Use a different account
        </Text>
        {__DEV__ && isDevTokenAllowed() ? (
          <Text
            size="xs"
            mono
            style={[styles.link, { color: t.palette.canyonClay }]}
            onPress={() => router.push('/dev-token')}
            accessibilityRole="button"
            testID="dev-token-link">
            DEV · Use an access token
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  top: { paddingHorizontal: 28, gap: 28 },
  bottom: { paddingHorizontal: 24, gap: 14 },
  link: { textAlign: 'center', color: 'rgba(246,246,245,0.8)', paddingVertical: 6 },
});
