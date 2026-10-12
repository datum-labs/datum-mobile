import { StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Link } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { StatusView } from '@/lib/status/types';

import { Icon } from './Icon';

/**
 * Summary card at the top of a detail screen: icon, status and the resource's
 * identifier on one line. The name itself is the screen's large title, so it
 * isn't repeated here; `title` is only the card's accessibility label.
 *
 * It's the zoom-transition target for the list row that pushed it
 * (Link.AppleZoomTarget). The target mounts exactly one native child, so the
 * card must not be flattened away (collapsable={false}), otherwise its
 * contents are silently dropped and the card renders blank.
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
        collapsable={false}
        accessibilityLabel={title}
        style={[styles.card, { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder }]}>
        <View style={styles.row}>
          {icon ? (
            <View style={[styles.iconWell, { backgroundColor: t.colors.accent }]}>
              <Icon name={icon} size={18} color={t.colors.primary} />
            </View>
          ) : null}
          <View style={styles.body}>
            {status ? <StatusBadge status={status.status} label={status.label} /> : null}
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
    </Link.AppleZoomTarget>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
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
