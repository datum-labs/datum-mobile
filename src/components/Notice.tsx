import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from './Icon';

type Kind = 'error' | 'warning' | 'info' | 'success';

const SYMBOL: Record<Kind, SymbolViewProps['name']> = {
  error: 'exclamationmark.octagon.fill',
  warning: 'exclamationmark.triangle.fill',
  info: 'info.circle.fill',
  success: 'checkmark.circle.fill',
};

/**
 * Inline message in the iOS style: a coloured SF Symbol beside plain text on
 * a neutral surface. Colour lives only in the symbol, never in the fill or
 * border. `surface="glass"` floats it on dark artwork (the Welcome screen) as
 * untinted Liquid Glass with light text.
 */
export function Notice({
  kind,
  title,
  description,
  icon,
  action,
  surface = 'card',
}: {
  kind: Kind;
  title: string;
  description?: string;
  icon?: SymbolViewProps['name'];
  action?: ReactNode;
  surface?: 'card' | 'glass';
}) {
  const t = useDatumTheme();
  const onGlass = surface === 'glass';
  const accent = {
    error: t.colors.destructive,
    warning: t.colors.warning,
    info: t.colors.info,
    success: t.colors.success,
  }[kind];
  const fg = onGlass ? '#f6f6f5' : t.colors.foreground;
  const muted = onGlass ? 'rgba(246,246,245,0.72)' : t.colors.mutedForeground;

  const body = (
    <View style={styles.row} accessibilityRole="alert">
      <Icon name={icon ?? SYMBOL[kind]} size={20} color={accent} />
      <View style={styles.text}>
        <Text size="sm" weight="semibold" style={{ color: fg }}>
          {title}
        </Text>
        {description ? (
          <Text size="sm" style={{ color: muted }} selectable>
            {description}
          </Text>
        ) : null}
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );

  if (onGlass && isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" colorScheme="dark" style={styles.surface}>
        {body}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        styles.surface,
        onGlass
          ? { backgroundColor: 'rgba(12,29,49,0.7)' }
          : { backgroundColor: t.colors.card, borderColor: t.colors.cardBorder, borderWidth: StyleSheet.hairlineWidth },
      ]}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { borderRadius: 18, borderCurve: 'continuous', paddingVertical: 14, paddingHorizontal: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  text: { flex: 1, gap: 3 },
  action: { marginTop: 8, alignItems: 'flex-start' },
});
