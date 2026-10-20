import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Link } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View, Platform } from 'react-native';

import type { StatusView } from '@/lib/status/types';

import { Icon } from './Icon';
import { StatusLabel } from './Grouped';

/**
 * Metadata line under a detail screen's large title: icon, status and the
 * resource's identifier, with no card behind it. The name itself is the large
 * title, so it isn't repeated here; `title` is only the accessibility label.
 *
 * It's the zoom-transition target for the list row that pushed it
 * (Link.AppleZoomTarget). The target mounts exactly one native child, so the
 * container must not be flattened away (collapsable={false}), otherwise its
 * contents are silently dropped and it renders blank.
 */
export function DetailHeader({
  title,
  subtitle,
  icon,
  status,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: SymbolViewProps['name'];
  status?: StatusView;
  children?: ReactNode;
}) {
  const t = useDatumTheme();
  const header = (
      <View
        collapsable={false}
        accessibilityLabel={title}
        style={styles.container}>
        <View style={styles.row}>
          {icon ? (
            <View style={[styles.iconWell, { backgroundColor: t.colors.accent }]}>
              <Icon name={icon} size={18} color={t.colors.primary} />
            </View>
          ) : null}
          <View style={styles.body}>
            {status ? <StatusLabel status={status.status} label={status.label} /> : null}
            {subtitle ? (
              <Text size="sm" tone="muted" mono numberOfLines={1} ellipsizeMode="middle" selectable>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {status?.detail ? (
          <Text size="xs" tone="muted" selectable>
            {status.detail}
          </Text>
        ) : null}
        {children}
      </View>
  );
  // Zoom transitions are iOS-only; Android just shows the header.
  return Platform.OS === 'ios' ? <Link.AppleZoomTarget>{header}</Link.AppleZoomTarget> : header;
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 4, paddingBottom: 4, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1, gap: 6, alignItems: 'flex-start' },
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
