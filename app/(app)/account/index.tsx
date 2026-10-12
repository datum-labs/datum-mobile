import { Avatar, Button, Text, Title, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert as NativeAlert, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { ContextPill } from '@/components/ContextPill';
import { InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { env } from '@/config/env';
import { useProjectContext } from '@/context/ProjectContext';
import { clearQueryCache } from '@/lib/query';

export default function Account() {
  const t = useDatumTheme();
  const { state, signIn, signOut } = useAuth();
  const { selection } = useProjectContext();
  const [busy, setBusy] = useState<'switch' | 'signout' | null>(null);
  const user = state.status === 'signedIn' ? state.user : undefined;
  const devToken = state.status === 'signedIn' && state.devToken;

  const switchAccount = async () => {
    setBusy('switch');
    const result = await signIn({ selectAccount: true });
    setBusy(null);
    if (result.type === 'success') {
      await clearQueryCache();
      router.replace('/home');
    } else if (result.type === 'error') {
      NativeAlert.alert("Couldn't switch account", result.message);
    }
  };

  const confirmSignOut = () =>
    NativeAlert.alert('Sign out of Datum?', 'You can sign back in at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setBusy('signout');
          await clearQueryCache();
          await signOut();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      <Screen>
        <View style={[styles.profile, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}>
          <Avatar name={user?.name ?? user?.email ?? '?'} size="xl" />
          <View style={{ flex: 1, gap: 2 }}>
            <Title level={4} numberOfLines={1}>
              {user?.name ?? 'Signed in'}
            </Title>
            {user?.email ? (
              <Text size="sm" tone="muted" numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
            {devToken ? (
              <Text size="xs" mono style={{ color: t.palette.canyonClay }}>
                DEV TOKEN SESSION
              </Text>
            ) : null}
          </View>
        </View>

        <Section title="Current project">
          <ContextPill />
          {selection ? (
            <InfoCard
              rows={[
                { label: 'Organization', value: selection.orgId, mono: true },
                { label: 'Project', value: selection.projectId, mono: true },
              ]}
            />
          ) : null}
        </Section>

        <Section title="Session">
          <View style={{ gap: 10 }}>
            <Button
              type="secondary"
              theme="outline"
              block
              loading={busy === 'switch'}
              disabled={busy !== null || devToken}
              onPress={switchAccount}>
              Switch account
            </Button>
            <Button
              type="danger"
              theme="light"
              block
              loading={busy === 'signout'}
              disabled={busy !== null}
              onPress={confirmSignOut}>
              Sign out
            </Button>
          </View>
        </Section>

        <Section title="Environment">
          <InfoCard
            rows={[
              { label: 'Variant', value: env.variant },
              { label: 'Version', value: env.version },
              { label: 'API', value: env.apiUrl.replace(/^https:\/\//, ''), mono: true },
              { label: 'Identity', value: env.auth.issuer.replace(/^https:\/\//, ''), mono: true },
              { label: 'User ID', value: user?.sub, mono: true },
              env.variant === 'staging'
                ? { label: 'OIDC client', value: env.auth.clientId || 'not set', mono: true }
                : null,
            ]}
          />
        </Section>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
