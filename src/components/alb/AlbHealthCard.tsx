import { Card, CardContent, Spinner, Text, useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View } from 'react-native';

import type { AlbHealth } from '@/resources/http-proxies/config';

import { Icon } from '../Icon';
import { PressableScale } from '../PressableScale';

const ICONS = {
  success: 'checkmark.circle.fill',
  warning: 'exclamationmark.triangle.fill',
  error: 'exclamationmark.octagon.fill',
  info: 'dot.radiowaves.left.and.right',
} as const;

/** The portal's ALB health headline: what's happening, in a sentence. */
export function AlbHealthCard({ health }: { health: AlbHealth }) {
  const t = useDatumTheme();
  const tone = {
    success: t.colors.success,
    warning: t.colors.warning,
    error: t.colors.destructive,
    info: t.colors.primary,
  }[health.tone];
  return (
    <Card size="sm">
      <CardContent style={styles.row}>
        <View style={[styles.ring, { backgroundColor: withAlpha(tone, 0.12) }]}>
          {health.busy ? <Spinner size="small" /> : <Icon name={ICONS[health.tone]} size={17} color={tone} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="sm" weight="semibold">
            {health.title}
          </Text>
          <Text size="xs" tone="muted">
            {health.detail}
          </Text>
          {health.retryRef ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Copy support reference ${health.retryRef}`}
              onPress={() => {
                void Clipboard.setStringAsync(health.retryRef as string);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
              }}
              style={[styles.ref, { backgroundColor: t.colors.muted }]}>
              <Icon name="doc.on.doc" size={11} color={t.colors.mutedForeground} />
              <Text size="xs" mono>
                {health.retryRef}
              </Text>
            </PressableScale>
          ) : null}
        </View>
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  ring: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  ref: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
});
