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
  /** Called on press, before navigating to `href` (e.g. to record a recent). */
  onSelect?: () => void;
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
  onSelect,
  ...rest
}: Omit<PressableProps, 'children'> & {
  label: string;
  children: ReactNode;
  onSelect?: () => void;
  ref?: Ref<View>;
}) {
  const t = useDatumTheme();
  const grouped = useInRowGroup();
  if (!grouped) {
    return (
      <PressableScale
        {...rest}
        onPress={(e) => {
          onSelect?.();
          onPress?.(e);
        }}
        accessibilityRole="button"
        accessibilityLabel={label}>
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
        onSelect?.();
        onPress?.(e);
      }}
      style={({ pressed }) => (pressed ? { backgroundColor: t.colors.muted } : null)}>
      {children}
    </Pressable>
  );
}

/**
 * Only the first rows stagger in: below them the list is off-screen or the
 * motion goes unseen, and every animated row costs a frame of work.
 */
const ANIMATED_ROWS = 8;
const ENTERING = Array.from({ length: ANIMATED_ROWS }, (_, i) =>
  FadeInDown.delay(i * 35)
    .duration(320)
    .withInitialValues({ transform: [{ translateY: 10 }] })
);
const LAYOUT = LinearTransition.duration(220);
// The zoom transition is iOS 18+ only; Android pushes with the standard Material motion.
// (A constant: React Compiler can't compile an expression as a parameter default.)
const ZOOM_BY_DEFAULT = Platform.OS === 'ios';

/**
 * A list row: inside a RowGroup it's a table cell, otherwise its own card.
 * With `href` it pushes the detail screen using the iOS 18+ zoom transition
 * from this row (Link.AppleZoom).
 */
export function ResourceRow(props: ResourceRowProps) {
  const { href, index = 0, testID, zoom = ZOOM_BY_DEFAULT } = props;
  return (
    <Animated.View entering={index < ANIMATED_ROWS ? ENTERING[index] : undefined} layout={LAYOUT} testID={testID}>
      {href && zoom ? (
        <Link href={href} asChild>
          <Link.AppleZoom>
            <RowPress label={props.title} onSelect={props.onSelect}>
              <RowBody {...props} />
            </RowPress>
          </Link.AppleZoom>
        </Link>
      ) : href ? (
        <Link href={href} asChild>
          <RowPress label={props.title} onSelect={props.onSelect}>
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
