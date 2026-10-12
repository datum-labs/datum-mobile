import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { useDatumTheme } from '@datum-cloud/datum-ui-native';

type Props = {
  name: SymbolViewProps['name'];
  size?: number;
  color?: ColorValue;
  weight?: SymbolViewProps['weight'];
} & Omit<SymbolViewProps, 'name' | 'size' | 'tintColor' | 'weight'>;

/** SF Symbol, tinted with the theme foreground by default. */
export function Icon({ name, size = 18, color, weight = 'medium', style, ...rest }: Props) {
  const { colors } = useDatumTheme();
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color ?? colors.foreground}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
      {...rest}
    />
  );
}
