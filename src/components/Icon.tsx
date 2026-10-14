import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, type ColorValue } from 'react-native';

import { useDatumTheme } from '@datum-cloud/datum-ui-native';

import { materialSymbolFor } from '@/lib/icons/material';

type Props = {
  name: SymbolViewProps['name'];
  size?: number;
  color?: ColorValue;
  weight?: SymbolViewProps['weight'];
} & Omit<SymbolViewProps, 'name' | 'size' | 'tintColor' | 'weight'>;

/**
 * SF Symbol on iOS, its Material Symbol on Android (see lib/icons/material),
 * tinted with the theme foreground by default.
 */
export function Icon({ name, size = 18, color, weight = 'medium', style, ...rest }: Props) {
  const { colors } = useDatumTheme();
  const resolved = typeof name === 'string' ? { ios: name, android: materialSymbolFor(name) } : name;
  return (
    <SymbolView
      name={resolved}
      size={size}
      tintColor={color ?? colors.foreground}
      // Material weights come as fonts (expo-symbols/androidWeights); the default reads fine.
      weight={Platform.OS === 'ios' ? weight : undefined}
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
      {...rest}
    />
  );
}
