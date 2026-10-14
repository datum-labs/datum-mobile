import { impactHaptic } from '@datum-cloud/datum-ui-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { Alert, Share } from 'react-native';

import { hostnameUrl } from './hostnames';

/** Open, copy and share a hostname (the hostname ⋯ menu on both platforms). */
export async function openHostname(hostname: string) {
  impactHaptic('light');
  try {
    await Linking.openURL(hostnameUrl(hostname));
  } catch {
    Alert.alert("Couldn't open link", hostnameUrl(hostname));
  }
}

export async function copyHostname(hostname: string) {
  await Clipboard.setStringAsync(hostname);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function shareHostname(hostname: string) {
  void Share.share({ url: hostnameUrl(hostname), message: hostnameUrl(hostname) }).catch(() => undefined);
}
