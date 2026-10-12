import { Spinner, Text, useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

type Props = {
  label: string;
  onPress?: () => void;
  icon?: SymbolViewProps['name'];
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Floating Liquid Glass control (iOS 26 UIGlassEffect via expo-glass-effect),
 * deliberately untinted. Falls back to a solid fill where glass isn't available.
 */
export function GlassButton({
  label,
  onPress,
  icon,
  loading,
  disabled,
  style,
  testID,
}: Props) {
  const t = useDatumTheme();
  const fg = t.colors.foreground;
  const glass = isLiquidGlassAvailable();
  const content = (
    <View style={styles.content}>
      {loading ? (
        <Spinner size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={17} color={fg} weight="semibold" />
      ) : null}
      <Text size="base" weight="semibold" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
      style={[{ opacity: disabled ? 0.5 : 1 }, style]}>
      {glass ? (
        <GlassView
          glassEffectStyle="regular"
          isInteractive
          style={styles.pill}>
          {content}
        </GlassView>
      ) : (
        <View style={[styles.pill, { backgroundColor: withAlpha(t.colors.card, 0.9) }]}>
          {content}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 54,
    borderRadius: 27,
    paddingHorizontal: 24,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});
