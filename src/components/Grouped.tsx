import { Card as DatumCard, Text, useDatumTheme, type CardProps } from '@datum-cloud/datum-ui-native';
import type { SymbolViewProps } from 'expo-symbols';
import { Children, createContext, Fragment, use, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import type { BadgeStatus } from '@/lib/status/types';

import { Icon } from './Icon';

/**
 * iOS 26-style grouped surfaces: large continuous corners, no outline, rows
 * sharing one container with inset separators (Settings, Health).
 */
export const GROUPED_RADIUS = 26;

export const groupedSurface: ViewStyle = {
  borderRadius: GROUPED_RADIUS,
  borderCurve: 'continuous',
  borderWidth: 0,
};

/** datum-ui-native's Card on the grouped surface. */
export function Card({ style, ...props }: CardProps) {
  return <DatumCard {...props} style={[groupedSurface, style]} />;
}

/** True inside a RowGroup: rows drop their own surface. */
export const InRowGroup = createContext(false);

/**
 * Rows in one rounded container, separated by hairlines inset past the
 * row icon. Children are ResourceRows (or anything row-shaped).
 */
export function RowGroup({ children, inset = 62 }: { children: ReactNode; inset?: number }) {
  const t = useDatumTheme();
  const rows = Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <InRowGroup value>
      <View style={[groupedSurface, styles.group, { backgroundColor: t.colors.card }]}>
        {rows.map((row, i) => (
          <Fragment key={(row as { key?: string }).key ?? i}>
            {i > 0 ? (
              <View style={[styles.separator, { marginLeft: inset, backgroundColor: t.colors.border }]} />
            ) : null}
            {row}
          </Fragment>
        ))}
      </View>
    </InRowGroup>
  );
}

export function useInRowGroup() {
  return use(InRowGroup);
}

const STATUS_SYMBOL: Record<BadgeStatus, SymbolViewProps['name']> = {
  success: 'checkmark.circle.fill',
  error: 'exclamationmark.circle.fill',
  pending: 'clock.fill',
  unknown: 'minus.circle.fill',
};

/** A status as a coloured SF Symbol and label, the way system apps show it. */
export function StatusLabel({ status, label }: { status: BadgeStatus; label: string }) {
  const t = useDatumTheme();
  const color =
    status === 'success'
      ? t.colors.success
      : status === 'error'
        ? t.colors.destructive
        : status === 'pending'
          ? t.colors.warning
          : t.colors.mutedForeground;
  return (
    <View style={styles.status} accessibilityRole="text" accessibilityLabel={label}>
      <Icon name={STATUS_SYMBOL[status]} size={14} color={color} />
      <Text size="sm" weight="medium" numberOfLines={1} style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
});
