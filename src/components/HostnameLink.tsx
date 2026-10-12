import { impactHaptic, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import * as Linking from 'expo-linking';
import { Alert, StyleSheet, View } from 'react-native';

import { hostnameUrl, isOpenableHostname } from '@/lib/hostnames';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export async function openHostname(hostname: string) {
  impactHaptic('light');
  try {
    await Linking.openURL(hostnameUrl(hostname));
  } catch {
    Alert.alert("Couldn't open link", hostnameUrl(hostname));
  }
}

/**
 * A hostname that opens over HTTPS in the user's default browser. Wildcards
 * render as plain selectable text with a "Wildcard" hint instead.
 */
export function HostnameLink({
  hostname,
  size = 'base',
}: {
  hostname: string;
  size?: 'sm' | 'base';
}) {
  const t = useDatumTheme();
  const openable = isOpenableHostname(hostname);
  const label = (
    <Text
      size={size}
      weight="medium"
      mono
      numberOfLines={1}
      ellipsizeMode="middle"
      selectable={!openable}
      style={[styles.label, openable ? { color: t.colors.foreground } : undefined]}>
      {hostname}
    </Text>
  );

  if (!openable) {
    return (
      <View style={styles.row}>
        <Icon name="asterisk" size={14} color={t.colors.mutedForeground} />
        {label}
        <Text size="xs" tone="muted">
          Wildcard
        </Text>
      </View>
    );
  }

  return (
    <PressableScale
      onPress={() => void openHostname(hostname)}
      accessibilityRole="link"
      accessibilityLabel={`Open ${hostname}`}
      accessibilityHint="Opens in your default browser"
      haptic={false}
      style={styles.row}>
      <Icon name="link" size={14} color={t.colors.primary} />
      {label}
      <Icon name="arrow.up.right.square" size={16} color={t.colors.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  label: { flex: 1 },
});
