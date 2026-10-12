import { Spinner, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { completeFromCallback, isInteractiveSignInActive } from '@/auth/sign-in';

/**
 * `<scheme>:/oauth/callback`. Normally ASWebAuthenticationSession swallows
 * this URL and sign-in completes in place. It only lands here as a plain deep
 * link when the browser session was gone (e.g. the user verified their email
 * in Safari and came back) — then the stored PKCE state finishes the job.
 */
export default function OAuthCallback() {
  const t = useDatumTheme();
  const params = useLocalSearchParams<{
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }>();
  const [message, setMessage] = useState<string | undefined>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (isInteractiveSignInActive()) {
      // The in-app browser session will hand the code over itself.
      router.replace('/');
      return;
    }
    void completeFromCallback(params)
      .then((result) => {
        if (result.type === 'error') setMessage(result.message);
        else router.replace('/');
      })
      .catch((error: Error) => setMessage(error.message));
  }, [params]);

  return (
    <View style={[styles.root, { backgroundColor: t.colors.background }]}>
      {message ? (
        <>
          <Text size="base" weight="medium">
            Sign-in didn&apos;t finish
          </Text>
          <Text size="sm" tone="muted" style={{ textAlign: 'center' }}>
            {message}
          </Text>
          <Text size="sm" tone="primary" onPress={() => router.replace('/')}>
            Back to Datum
          </Text>
        </>
      ) : (
        <Spinner />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
});
