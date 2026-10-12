import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { isDevTokenAllowed } from '@/auth/dev-token';

export default function AuthLayout() {
  const { state, emailNotVerified } = useAuth();
  const t = useDatumTheme();
  const signedIn = state.status === 'signedIn';
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.background },
      }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && emailNotVerified}>
        <Stack.Screen name="verify-email" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn && isDevTokenAllowed()}>
        <Stack.Screen
          name="dev-token"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: [0.6],
            sheetGrabberVisible: true,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack.Protected>
    </Stack>
  );
}
