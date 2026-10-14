import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { StyleSheet, View } from 'react-native';

import { openHostname } from '@/lib/hostname-actions';
import { isOpenableHostname } from '@/lib/hostnames';

import { HostnameMenu } from './HostnameMenu';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export { openHostname } from '@/lib/hostname-actions';

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
