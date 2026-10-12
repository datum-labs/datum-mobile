import { Redirect } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';

/** `/` → the right group for the current session (Stack.Protected does the rest). */
export default function Index() {
  const { state, emailNotVerified } = useAuth();
  if (state.status === 'signedIn' && !emailNotVerified) return <Redirect href="/(home)/home" />;
  if (state.status === 'signedIn') return <Redirect href="/verify-email" />;
  return <Redirect href="/welcome" />;
}
