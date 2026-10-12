import { Text, useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useProjectContext } from '@/context/ProjectContext';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

/** Glass pill showing the current org › project; opens the context switcher. */
export function ContextPill() {
  const t = useDatumTheme();
  const { selection } = useProjectContext();
  const body = (
    <View style={styles.row}>
      <Icon name="square.stack.3d.up.fill" size={15} color={t.colors.primary} />
      <View style={{ flexShrink: 1 }}>
        <Text size="xs" tone="muted" numberOfLines={1}>
          {selection?.orgName ?? selection?.orgId ?? 'No organization'}
        </Text>
        <Text size="sm" weight="semibold" numberOfLines={1}>
          {selection?.projectName ?? selection?.projectId ?? 'Choose a project'}
        </Text>
      </View>
      <Icon name="chevron.up.chevron.down" size={13} color={t.colors.mutedForeground} />
    </View>
  );
  return (
    <PressableScale
      onPress={() => router.push('/context-switcher')}
      accessibilityRole="button"
      accessibilityLabel="Switch organization or project"
      style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
      {isLiquidGlassAvailable() ? (
        <GlassView
          isInteractive
          glassEffectStyle="regular"
          tintColor={withAlpha(t.palette.auroraMoss, 0.08)}
          style={styles.pill}>
          {body}
        </GlassView>
      ) : (
        <View style={[styles.pill, { backgroundColor: t.colors.card }]}>{body}</View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 22, paddingVertical: 8, paddingHorizontal: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
