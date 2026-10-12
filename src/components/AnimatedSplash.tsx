import { LogoIcon, LogoText, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** Matches the native splash (expo-splash-screen `backgroundColor` + `imageWidth`). */
const NAVY = '#0c1d31';
const NATIVE_MARK = 88;

/** Lockup geometry from datum-ui-native's FLAT artwork (742×148, wordmark at x 247–742, y 38–114). */
const LOCKUP_H = 44;
const K = LOCKUP_H / 148;
const LOCKUP_W = 742 * K;
const MARK_DX = -LOCKUP_W / 2 + (149 * K) / 2;
const TEXT_W = 495 * K;
const TEXT_H = 76 * K;
const TEXT_DX = -LOCKUP_W / 2 + 247 * K + TEXT_W / 2;
const TEXT_DY = -LOCKUP_H / 2 + 38 * K + TEXT_H / 2;

const MIN_VISIBLE_MS = 950;
const HARD_CAP_MS = 4000;
const EXIT_MS = 380;

const hero = require('@/assets/images/hero-portrait.jpg');

/**
 * JS handoff from the native splash. Starts pixel-identical to it (navy, mark
 * centred at 88pt) so there is no flash, then: the illustration fades in, the
 * mark slides into the wordmark lockup and a lime beam sweeps under it. Once
 * `ready` (auth + persisted cache hydrated) and the intro has played — or on
 * tap — it dissolves into whatever screen is underneath.
 */
export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone?: () => void }) {
  const { width, height } = useWindowDimensions();
  const t = useDatumTheme();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [minElapsed, setMinElapsed] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const exiting = useRef(false);

  const heroOpacity = useSharedValue(0);
  const lockup = useSharedValue(0);
  const beam = useSharedValue(0);
  const overlay = useSharedValue(1);

  const startIntro = () => {
    void SplashScreen.hideAsync();
    if (reduced) {
      heroOpacity.set(withTiming(0.9, { duration: 200 }));
      lockup.set(1);
      return;
    }
    const ease = Easing.bezier(0.22, 1, 0.36, 1);
    heroOpacity.set(withTiming(0.9, { duration: 520, easing: Easing.out(Easing.cubic) }));
    lockup.set(withDelay(140, withTiming(1, { duration: 560, easing: ease })));
    beam.set(withDelay(380, withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) })));
  };

  useEffect(() => {
    const min = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    const cap = setTimeout(() => setSkipped(true), HARD_CAP_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(cap);
    };
  }, []);

  useEffect(() => {
    if (!ready || exiting.current) return;
    if (!minElapsed && !skipped) return;
    exiting.current = true;
    const finish = () => {
      setVisible(false);
      onDone?.();
    };
    overlay.set(
      withTiming(0, { duration: EXIT_MS, easing: Easing.out(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(finish);
      })
    );
  }, [ready, minElapsed, skipped, overlay, onDone]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlay.value,
    transform: [{ scale: 1 + (1 - overlay.value) * 0.04 }],
  }));
  const heroStyle = useAnimatedStyle(() => ({ opacity: heroOpacity.value }));
  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: MARK_DX * lockup.value },
      { scale: 1 - 0.5 * lockup.value },
    ],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, (lockup.value - 0.35) / 0.65),
    transform: [{ translateX: TEXT_DX + 14 * (1 - lockup.value) }, { translateY: TEXT_DY }],
  }));
  const beamStyle = useAnimatedStyle(() => ({
    opacity: Math.sin(Math.PI * beam.value),
    transform: [{ translateX: -width * 0.6 + beam.value * width * 1.2 }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, overlayStyle]}
      pointerEvents={ready ? 'auto' : 'box-only'}
      onLayout={startIntro}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setSkipped(true)}>
        <Animated.View style={[StyleSheet.absoluteFill, heroStyle]}>
          <Image source={hero} style={{ width, height }} contentFit="cover" transition={0} />
          <LinearGradient
            colors={[NAVY, 'rgba(12,29,49,0.0)', 'rgba(12,29,49,0.55)']}
            locations={[0.18, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <View style={styles.center}>
          <Animated.View style={[styles.beam, beamStyle]}>
            <LinearGradient
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              colors={['rgba(230,245,159,0)', t.palette.auroraMoss, 'rgba(230,245,159,0)']}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View style={[styles.abs, markStyle]}>
            <LogoIcon size={NATIVE_MARK} tone="mono-light" decorative />
          </Animated.View>
          <Animated.View style={[styles.abs, textStyle]}>
            <LogoText height={TEXT_H} tone="mono-light" decorative />
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: NAVY, zIndex: 1000 },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
  beam: {
    position: 'absolute',
    width: 180,
    height: 2,
    marginTop: LOCKUP_H + 36,
    borderRadius: 1,
    overflow: 'hidden',
  },
});
