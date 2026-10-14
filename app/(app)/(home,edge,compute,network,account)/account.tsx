import { Stack } from 'expo-router';

import { AccountScreen } from '@/components/account/AccountScreen';

/**
 * Account: a SwiftUI Form on iOS, a Material 3 settings list on Android
 * (platform files under components/account).
 */
export default function Account() {
  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      <AccountScreen />
    </>
  );
}
