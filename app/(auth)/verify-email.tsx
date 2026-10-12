import { Button, Text, Title, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, userScopedBase } from '@/api';
import { EmailNotVerifiedError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { EMPTY_STATE_ART } from '@/components/states';
import { env } from '@/config/env';

export default function VerifyEmail() {
  const t = useDatumTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { state, recheckEmail, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  const [stillUnverified, setStillUnverified] = useState(false);
  const email = state.status === 'signedIn' ? state.user.email : undefined;
  const sub = state.status === 'signedIn' ? state.user.sub : undefined;

  const check = async () => {
    if (!sub) return;
    setChecking(true);
    setStillUnverified(false);
    try {
      await recheckEmail();
      // Any user-scoped read will do; it throws again if milo still says no.
      await api.get(
        `${userScopedBase(sub)}/apis/resourcemanager.miloapis.com/v1alpha1/organizationmemberships`,
        { query: { limit: 1 } }
      );
      await queryClient.invalidateQueries();
    } catch (error) {
      if (error instanceof EmailNotVerifiedError) setStillUnverified(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
      ]}>
      <Image source={EMPTY_STATE_ART} style={styles.scene} contentFit="contain" />
      <View style={{ gap: 10 }}>
        <Title level={2}>Verify your email</Title>
        <Text size="base" tone="muted">
          Datum Cloud needs a verified email address before it will show your organizations.
          {email ? ` We sent a link to ${email}.` : ''} Open it, then come back here.
        </Text>
        {stillUnverified ? (
          <Text size="sm" tone="warning">
            Still waiting on verification. It can take a minute to come through.
          </Text>
        ) : null}
      </View>
      <View style={{ gap: 12 }}>
        <Button type="primary" theme="solid" size="large" block loading={checking} onPress={check}>
          I&apos;ve verified my email
        </Button>
        <Button
          type="secondary"
          theme="outline"
          size="large"
          block
          onPress={() => void WebBrowser.openBrowserAsync(env.portalUrl)}>
          Open Datum Cloud
        </Button>
        <Button type="quaternary" theme="borderless" block onPress={() => void signOut()}>
          Sign out
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 24, gap: 28, flexGrow: 1, justifyContent: 'center' },
  scene: { width: '100%', height: 120 },
});
