import { StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Link, type Href } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import type { StatusView } from '@/lib/status/types';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export interface ResourceRowProps {
  title: string;
  subtitle?: string;
  /** Third line, e.g. a hostname or CIDR, in monospace. */
  meta?: string;
  icon?: SymbolViewProps['name'];
  status?: StatusView;
  trailing?: ReactNode;
  href?: Href;
  /** Zoom into the pushed screen. Turn off for links into another tab, which iOS can't zoom across. */
  zoom?: boolean;
  /** Position in the list, for the staggered entering animation. */
  index?: number;
  testID?: string;
}

function RowBody({ title, subtitle, meta, icon, status, trailing, href }: ResourceRowProps) {
  const t = useDatumTheme();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder, borderRadius: 16 },
      ]}>
      {icon ? (
        <View style={[styles.iconWell, { backgroundColor: t.colors.accent }]}>
          <Icon name={icon} size={18} color={t.colors.primary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text size="base" weight="medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text size="xs" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? (
          <Text size="xs" tone="muted" mono numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        {trailing}
        {status ? <StatusBadge status={status.status} label={status.label} /> : null}
        {href ? <Icon name="chevron.right" size={13} color={t.colors.mutedForeground} /> : null}
      </View>
    </View>
  );
}

/**
 * A list row as a card. With `href` it pushes the detail screen using the
 * iOS 18+ zoom transition from this row (Link.AppleZoom).
 */
export function ResourceRow(props: ResourceRowProps) {
  // The zoom transition is iOS 18+ only; Android pushes with the standard Material motion.
  const { href, index = 0, testID, zoom = Platform.OS === 'ios' } = props;
  const entering = FadeInDown.delay(Math.min(index, 12) * 35)
    .duration(320)
    .withInitialValues({ transform: [{ translateY: 10 }] });
  return (
    <Animated.View entering={entering} layout={LinearTransition.duration(220)} testID={testID}>
      {href && zoom ? (
        <Link href={href} asChild>
          <Link.AppleZoom>
            <PressableScale accessibilityRole="button" accessibilityLabel={props.title}>
              <RowBody {...props} />
            </PressableScale>
          </Link.AppleZoom>
        </Link>
      ) : href ? (
        <Link href={href} asChild>
          <PressableScale accessibilityRole="button" accessibilityLabel={props.title}>
            <RowBody {...props} />
          </PressableScale>
        </Link>
      ) : (
        <RowBody {...props} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
});
