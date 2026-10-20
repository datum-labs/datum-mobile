import { impactHaptic, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Link, type Href } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode, Ref } from 'react';
import { Platform, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import type { StatusView } from '@/lib/status/types';

import { GROUPED_RADIUS, StatusLabel, useInRowGroup } from './Grouped';
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
  const grouped = useInRowGroup();
  return (
    <View
      style={[
        styles.row,
        // In a RowGroup the group draws the surface.
        grouped ? null : { backgroundColor: t.colors.card, borderRadius: GROUPED_RADIUS, borderCurve: 'continuous' },
      ]}>
      {icon ? (
        <View style={[styles.iconWell, { backgroundColor: t.colors.accent }]}>
          <Icon name={icon} size={17} color={t.colors.primary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text size="base" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text size="sm" tone="muted" numberOfLines={1}>
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
        {status ? <StatusLabel status={status.status} label={status.label} /> : null}
        {href ? <Icon name="chevron.right" size={13} weight="semibold" color={t.colors.mutedForeground} /> : null}
      </View>
    </View>
  );
}

/** Grouped rows highlight while pressed, like a table cell; standalone rows press-scale. */
// Link asChild hands its onPress (and ref) to this, so pass the props through.
function RowPress({
  label,
  children,
  onPress,
  ...rest
}: Omit<PressableProps, 'children'> & { label: string; children: ReactNode; ref?: Ref<View> }) {
  const t = useDatumTheme();
  const grouped = useInRowGroup();
  if (!grouped) {
    return (
      <PressableScale {...rest} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        {children}
      </PressableScale>
    );
  }
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={(e) => {
        impactHaptic('light');
        onPress?.(e);
      }}
      style={({ pressed }) => (pressed ? { backgroundColor: t.colors.muted } : null)}>
      {children}
    </Pressable>
  );
}

/**
 * A list row: inside a RowGroup it's a table cell, otherwise its own card.
 * With `href` it pushes the detail screen using the iOS 18+ zoom transition
 * from this row (Link.AppleZoom).
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
            <RowPress label={props.title}>
              <RowBody {...props} />
            </RowPress>
          </Link.AppleZoom>
        </Link>
      ) : href ? (
        <Link href={href} asChild>
          <RowPress label={props.title}>
            <RowBody {...props} />
          </RowPress>
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
    paddingVertical: 11,
    minHeight: 60,
  },
  iconWell: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0, maxWidth: '45%' },
});
