import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { OWASP_CRS_CATEGORIES, type WafCategoriesView } from '@/resources/http-proxies/config';

import { Icon } from '../Icon';
import { PressableScale } from '../PressableScale';

/**
 * "Rule categories: 8 of 10 categories · 2 excluded", expanding to each OWASP
 * CRS category with whether it's on. Used as an InfoCard value.
 */
export function WafCategoriesRow({ view }: { view: WafCategoriesView }) {
  const t = useDatumTheme();
  const [open, setOpen] = useState(false);
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(open ? '180deg' : '0deg', { duration: 200 }) }],
  }));
  return (
    <View style={{ alignSelf: 'stretch', gap: 10 }}>
      <PressableScale
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Rule categories: ${view.summary}`}
        style={styles.summary}>
        <Text size="sm" style={{ flex: 1 }}>
          {view.summary}
        </Text>
        <Animated.View style={chevron}>
          <Icon name="chevron.down" size={12} color={t.colors.mutedForeground} weight="semibold" />
        </Animated.View>
      </PressableScale>
      {open ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ gap: 10 }}>
          {OWASP_CRS_CATEGORIES.map((category) => {
            const on = !view.excluded.includes(category);
            return (
              <View key={category.id} style={styles.category}>
                <Icon
                  name={on ? 'checkmark.circle.fill' : 'minus.circle'}
                  size={15}
                  color={on ? t.colors.success : t.colors.mutedForeground}
                />
                <View style={{ flex: 1, gap: 1 }}>
                  <Text size="sm" weight="medium" tone={on ? undefined : 'muted'}>
                    {category.label}
                    {on ? '' : ' · excluded'}
                  </Text>
                  <Text size="xs" tone="muted">
                    {category.description}
                  </Text>
                </View>
              </View>
            );
          })}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  category: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
