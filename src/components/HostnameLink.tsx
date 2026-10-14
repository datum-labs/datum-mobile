import { impactHaptic, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Button, Host, Menu } from '@expo/ui/swift-ui';
import { labelStyle, tint } from '@expo/ui/swift-ui/modifiers';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { Alert, Share, StyleSheet, View } from 'react-native';

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

async function copyHostname(hostname: string) {
  await Clipboard.setStringAsync(hostname);
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** Native ⋯ menu: open, copy and share a hostname (copy only for wildcards). */
function HostnameMenu({ hostname, openable }: { hostname: string; openable: boolean }) {
  const t = useDatumTheme();
  return (
    <Host matchContents colorScheme={t.scheme}>
      <Menu
        label={`Actions for ${hostname}`}
        systemImage="ellipsis.circle"
        modifiers={[labelStyle('iconOnly'), tint(t.colors.primary)]}>
        {openable ? (
          <Button label="Open in Browser" systemImage="safari" onPress={() => void openHostname(hostname)} />
        ) : null}
        <Button label="Copy Hostname" systemImage="doc.on.doc" onPress={() => void copyHostname(hostname)} />
        {openable ? (
          <Button
            label="Share…"
            systemImage="square.and.arrow.up"
            onPress={() => void Share.share({ url: hostnameUrl(hostname) }).catch(() => undefined)}
          />
        ) : null}
      </Menu>
    </Host>
  );
}

/**
 * A hostname that opens over HTTPS in the user's default browser, with a ⋯
 * menu to open, copy or share it. Wildcards can't be opened, so they show a
 * "Wildcard" hint and only offer Copy.
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
      style={[styles.label, { color: openable ? t.colors.primary : t.colors.foreground }]}>
      {hostname}
    </Text>
  );

  return (
    <View style={styles.row}>
      {openable ? (
        <PressableScale
          onPress={() => void openHostname(hostname)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${hostname}`}
          accessibilityHint="Opens in your default browser"
          haptic={false}
          style={styles.main}>
          <Icon name="globe" size={14} color={t.colors.mutedForeground} />
          {label}
        </PressableScale>
      ) : (
        <View style={styles.main}>
          <Icon name="asterisk" size={14} color={t.colors.mutedForeground} />
          {label}
          <Text size="xs" tone="muted">
            Wildcard
          </Text>
        </View>
      )}
      <HostnameMenu hostname={hostname} openable={openable} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32, alignSelf: 'stretch' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  label: { flexShrink: 1 },
});
