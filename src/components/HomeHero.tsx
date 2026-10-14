import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { Icon } from './Icon';

/** The illustration's night sky (= the `midnight-fjord` palette colour). */
export const HERO_SKY = '#0c1d31';

/** datum.net's hero illustration: explorers, the lime beam, the fox. 3506×2430 source. */
const ART = require('@/assets/images/hero-wide.jpg');
const ART_ASPECT = 3506 / 2430;
/** Room for the title above the scene, on the sky. */
const TITLE_BLOCK = 92;
/** Screen's content padding above the first child, which the hero also covers. */
const SCREEN_PAD_TOP = 8;
/** How much of the scene shows: its top is sky, the same colour as the band. */
const SCENE_SHOWN = 0.62;

export interface HomeHeroSummary {
  tone: 'success' | 'warning' | 'error';
  label: string;
}

/**
 * Home's header artwork: the project name in Canela on the illustration's
 * night sky, with the scene running full-bleed to its bottom edge, where
 * `HomeHeroPanel` (the page content) overlaps it with rounded corners. It sits under the
 * transparent nav bar (`headerHeight` above the title), moves at half speed
 * as the page scrolls and stretches on pull-to-refresh.
 *
 * `scrollY` is the content offset relative to rest (0 at the top).
 */
export function HomeHero({
  title,
  subtitle,
  summary,
  headerHeight,
  scrollY,
}: {
  title: string;
  subtitle?: string;
  summary?: HomeHeroSummary;
  headerHeight: number;
  scrollY: SharedValue<number>;
}) {
  const t = useDatumTheme();
  const { width } = useWindowDimensions();
  const artHeight = width / ART_ASPECT;
  const height = headerHeight + TITLE_BLOCK + artHeight * SCENE_SHOWN;

  const art = useAnimatedStyle(() => {
    const y = scrollY.value;
    return {
      transform: [
        // Pull down: stretch from the bottom edge. Scroll up: parallax at half speed.
        { translateY: y < 0 ? y / 2 : y * 0.45 },
        { scale: interpolate(y, [-height, 0], [2, 1], Extrapolation.CLAMP) },
      ],
    };
  });
  const text = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, TITLE_BLOCK], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: scrollY.value > 0 ? scrollY.value * 0.25 : 0 }],
  }));

  const dot = summary
    ? { success: t.colors.success, warning: t.colors.warning, error: t.colors.destructive }[summary.tone]
    : undefined;

  return (
    <View
      style={[styles.root, { height: height + SCREEN_PAD_TOP, marginTop: -headerHeight - SCREEN_PAD_TOP }]}
      accessibilityRole="header">
      {/* Clip at the hero's bottom edge (the scene mustn't slide under the
          content below), but leave room above for the pull-down stretch. */}
      <View pointerEvents="none" style={styles.clip}>
      <Animated.View style={[styles.layer, { height: height + SCREEN_PAD_TOP, backgroundColor: HERO_SKY }, art]}>
        <Animated.Image
          source={ART}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
          style={[styles.art, { width, height: artHeight }]}
        />
      </Animated.View>
      </View>
      <Animated.View style={[styles.text, { top: headerHeight + SCREEN_PAD_TOP + 4 }, text]}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[styles.title, { fontFamily: t.fonts.title }]}>
          {title}
        </Text>
        <View style={styles.meta}>
          {subtitle ? (
            <Text size="sm" numberOfLines={1} style={{ color: 'rgba(255,255,255,0.72)', flexShrink: 1 }}>
              {subtitle}
            </Text>
          ) : null}
          {summary && dot ? (
            <View style={styles.pill}>
              {summary.tone === 'success' ? (
                <Icon name="checkmark.circle.fill" size={12} color={dot} />
              ) : (
                <View style={[styles.dot, { backgroundColor: dot }]} />
              )}
              <Text size="xs" weight="medium" style={{ color: '#fff' }}>
                {summary.label}
              </Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginHorizontal: -16, overflow: 'visible' },
  art: { position: 'absolute', bottom: 0, left: 0 },
  clip: { position: 'absolute', left: 0, right: 0, bottom: 0, top: -2000, overflow: 'hidden' },
  layer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  text: { position: 'absolute', left: 20, right: 20, gap: 8 },
  title: { color: '#fff', fontSize: 40, lineHeight: 46 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});

/** How far the content panel overlaps the bottom of the artwork. */
const PANEL_OVERLAP = 28;
/** Screen's gap between children, which the overlap also has to swallow. */
const SCREEN_GAP = 20;

/**
 * The page content under the hero, on a panel with large continuous top
 * corners that rides up over the artwork, like a sheet over a photo.
 */
export function HomeHeroPanel({ children }: { children: React.ReactNode }) {
  const t = useDatumTheme();
  return (
    <View
      style={[
        panelStyles.panel,
        { backgroundColor: t.colors.background, marginTop: -(PANEL_OVERLAP + SCREEN_GAP) },
      ]}>
      {children}
    </View>
  );
}

const panelStyles = StyleSheet.create({
  panel: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingTop: 22,
    gap: 20,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderCurve: 'continuous',
  },
});
