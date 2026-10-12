import { Alert, Button, Text, Title, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { isDevTokenAllowed } from '@/auth/dev-token';

/**
 * DEV ONLY (staging, __DEV__): paste an access token, e.g. from
 * `datumctl auth get-token`, to try the app before the iOS OIDC client exists.
 * In release builds this renders nothing and the route is guarded off.
 */
export default function DevToken() {
  const t = useDatumTheme();
  const { signInWithDevToken } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | undefined>();

  if (!__DEV__ || !isDevTokenAllowed() || !signInWithDevToken) return null;

  const submit = () => {
    try {
      signInWithDevToken(token);
      router.dismissAll();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: t.colors.background }]}>
      <Title level={4}>Development token</Title>
      <Text size="sm" tone="muted">
        Staging debug builds only. The token stays in memory and is never refreshed or stored.
      </Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="eyJhbGciOi…"
        placeholderTextColor={t.colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        style={[
          styles.input,
          { color: t.colors.foreground, borderColor: t.colors.border, fontFamily: t.fonts.mono },
        ]}
      />
      {error ? <Alert type="destructive" title="Token rejected" description={error} /> : null}
      <Button type="primary" theme="solid" block disabled={!token.trim()} onPress={submit}>
        Use token
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, gap: 14 },
  input: { minHeight: 110, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 12 },
});
