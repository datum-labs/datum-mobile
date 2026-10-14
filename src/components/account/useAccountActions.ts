import { router } from 'expo-router';
import { useState } from 'react';
import { Alert as NativeAlert } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { useProjectContext } from '@/context/ProjectContext';
import { clearQueryCache } from '@/lib/query';
import { useUserProfile } from '@/resources/users/queries';

/**
 * Everything the Account screen shows and does, shared by the SwiftUI (iOS)
 * and Material 3 (Android) renderings: the signed-in user and profile, the
 * current project, and the Switch Account / Sign Out actions.
 */
export function useAccountActions() {
  const { state, signIn, signOut } = useAuth();
  const { selection } = useProjectContext();
  const [busy, setBusy] = useState(false);
  const user = state.status === 'signedIn' ? state.user : undefined;
  const devToken = state.status === 'signedIn' && state.devToken;
  const profile = useUserProfile(user?.sub).data;
  const name = profile?.fullName ?? user?.name;
  const email = profile?.email ?? user?.email;

  const switchAccount = async () => {
    setBusy(true);
    const result = await signIn({ selectAccount: true });
    setBusy(false);
    if (result.type === 'success') {
      await clearQueryCache();
      router.replace('/(home)/home');
    } else if (result.type === 'error') {
      NativeAlert.alert("Couldn't switch account", result.message);
    }
  };

  const doSignOut = async () => {
    setBusy(true);
    await clearQueryCache();
    await signOut();
  };

  return { selection, busy, user, devToken, profile, name, email, switchAccount, doSignOut };
}

/** "https://api.example.com" → "api.example.com", for the About section. */
export const apiHost = (url: string) => url.replace(/^https:\/\//, '');
