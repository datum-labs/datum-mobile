import { Redirect } from 'expo-router';

/** `<scheme>:/oauth/logout` — end_session's post-logout redirect. Nothing to do but go home. */
export default function OAuthLogout() {
  return <Redirect href="/" />;
}
