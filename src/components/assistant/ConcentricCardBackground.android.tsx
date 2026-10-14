import { useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import { StyleSheet, View } from 'react-native';

/**
 * Android: no concentric screen corners, so the composer card is a plain
 * rounded card with the same border (the iOS version molds to the display).
 */
export function ConcentricCardBackground({ radius = 16 }: { radius?: number }) {
  const t = useDatumTheme();
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius,
          borderWidth: 1,
          borderColor: withAlpha(t.colors.primary, 0.3),
          backgroundColor: t.colors.card,
        },
      ]}
    />
  );
}
