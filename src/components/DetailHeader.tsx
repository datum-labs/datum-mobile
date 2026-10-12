import { StatusBadge, Text, Title, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Link } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { StatusView } from '@/lib/status/types';

import { Icon } from './Icon';

/**
 * Top card on a detail screen. It's the zoom-transition target for the list
 * row that pushed it (Link.AppleZoomTarget).
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
  return (
    <Link.AppleZoomTarget>
      <View
        style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}>
        <View style={styles.top}>
          {icon ? (
            <View style={[styles.iconWell, { backgroundColor: t.colors.accent }]}>
              <Icon name={icon} size={22} color={t.colors.primary} />
            </View>
          ) : null}
          <View style={{ flex: 1, gap: 4 }}>
            <Title level={3} numberOfLines={2}>
              {title}
            </Title>
            {subtitle ? (
              <Text size="sm" tone="muted" mono numberOfLines={2} selectable>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {status ? (
          <View style={{ gap: 6 }}>
            <View style={{ alignSelf: 'flex-start' }}>
              <StatusBadge status={status.status} label={status.label} />
            </View>
            {status.detail ? (
              <Text size="xs" tone="muted" selectable>
                {status.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
        {children}
      </View>
    </Link.AppleZoomTarget>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 14,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  iconWell: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
