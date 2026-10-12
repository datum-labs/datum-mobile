import { impactHaptic } from '@datum-cloud/datum-ui-native';
import type { ReactNode, Ref } from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  children?: ReactNode;
  /** Scale while pressed. */
  scaleTo?: number;
  haptic?: boolean;
  ref?: Ref<View>;
};

/** Pressable with a spring press-scale and a light haptic on press. */
export function PressableScale({
  children,
  scaleTo = 0.97,
  haptic = true,
  onPressIn,
  onPressOut,
  onPress,
  style,
  ...rest
}: Props) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        if (!reduced) scale.set(withSpring(scaleTo, { damping: 20, stiffness: 400 }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withSpring(1, { damping: 16, stiffness: 300 }));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (haptic) impactHaptic('light');
        onPress?.(e);
      }}
      style={[animated, style as object]}>
      {children}
    </AnimatedPressable>
  );
}
