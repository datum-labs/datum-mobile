import { useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import { ConcentricRectangle, EdgeCornerStyle, Host, ZStack } from '@expo/ui/swift-ui';
import { foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

const BORDER = 1;

const corners = (radius: number) => ({
  topLeadingCorner: EdgeCornerStyle.fixed(radius),
  topTrailingCorner: EdgeCornerStyle.fixed(radius),
  // iOS 26 concentric corners: follow the display's own corner curve when the
  // card is docked at the bottom edge, and fall back to `radius` elsewhere
  // (e.g. sitting above the keyboard).
  bottomLeadingCorner: EdgeCornerStyle.concentric(radius),
  bottomTrailingCorner: EdgeCornerStyle.concentric(radius),
});

/**
 * Background for a card docked at the bottom of the screen, drawn as SwiftUI
 * ConcentricRectangles so its bottom corners mold to the device's screen
 * corners. The border is an outer shape in the border colour with the card
 * colour inset by 1pt on top: @expo/ui's strokeBorder modifier strokes its own
 * rectangle, not the shape it's applied to. Render it as the first child of the
 * card's wrapper; it ignores touches.
 */
export function ConcentricCardBackground({ radius = 16 }: { radius?: number }) {
  const t = useDatumTheme();
  return (
    // ignoreSafeArea: the card reaches into the home-indicator zone, and SwiftUI
    // would otherwise lay the shape out inside the safe area, short of the card.
    <Host style={StyleSheet.absoluteFill} pointerEvents="none" colorScheme={t.scheme} ignoreSafeArea="all">
      <ZStack>
        <ConcentricRectangle
          corners={corners(radius)}
          modifiers={[foregroundStyle(withAlpha(t.colors.primary, 0.3))]}
        />
        <ConcentricRectangle
          corners={corners(radius - BORDER)}
          modifiers={[padding({ all: BORDER }), foregroundStyle(t.colors.card)]}
        />
      </ZStack>
    </Host>
  );
}
