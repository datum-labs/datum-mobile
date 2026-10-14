import { Card, CardContent, CardField, StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { timeAgo } from '@/lib/format';
import type { Condition } from '@/resources/shared';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export type InfoRow =
  | {
      label: string;
      value?: ReactNode;
      mono?: boolean;
      /** Value on its own full-width line under the label (long values, hostnames). */
      stacked?: boolean;
    }
  | false
  | null
  | undefined;

/** Label/value card; rows with an empty value are skipped. */
export function InfoCard({ rows }: { rows: InfoRow[] }) {
  const visible = rows.filter(
    (row): row is Exclude<InfoRow, false | null | undefined> =>
      !!row && row.value !== undefined && row.value !== null && row.value !== ''
  );
  if (visible.length === 0) return null;
  return (
    <Card size="sm" sectioned>
      <CardContent padding="none">
        {visible.map((row) =>
          typeof row.value === 'string' || typeof row.value === 'number' ? (
            <CardField
              key={row.label}
              label={row.label}
              layout={row.stacked ? 'stacked' : 'inline'}
              value={
                <Text
                  size="sm"
                  mono={row.mono}
                  selectable
                  numberOfLines={row.stacked ? undefined : 3}
                  tone={row.stacked ? 'muted' : undefined}
                  style={{ textAlign: row.stacked ? 'left' : 'right' }}>
                  {String(row.value)}
                </Text>
              }
            />
          ) : (
            <CardField
              key={row.label}
              label={row.label}
              value={row.value}
              layout={row.stacked ? 'stacked' : 'inline'}
              valueStyle={row.stacked ? styles.stackedValue : undefined}
            />
          )
        )}
      </CardContent>
    </Card>
  );
}

function conditionStatus(c: Condition): 'success' | 'error' | 'pending' | 'unknown' {
  if (c.status === 'True') return 'success';
  if (c.status === 'Unknown') return 'unknown';
  return 'pending';
}

/**
 * Raw status conditions, for the curious (and support). Collapsed to a
 * one-line summary by default; tap to show each condition.
 */
export function ConditionsCard({
  conditions,
  defaultExpanded = false,
}: {
  conditions: Condition[];
  defaultExpanded?: boolean;
}) {
  const t = useDatumTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(expanded ? '180deg' : '0deg', { duration: 200 }) }],
  }));
  if (conditions.length === 0) return null;

  const pending = conditions.filter((c) => c.status !== 'True');
  const allMet = pending.length === 0;
  const summary = allMet
    ? conditions.length === 1
      ? '1 condition met'
      : `All ${conditions.length} conditions met`
    : `${conditions.length - pending.length} of ${conditions.length} met`;

  return (
    <Card size="sm" sectioned>
      <CardContent padding="none">
        <PressableScale
          onPress={() => setExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`Conditions: ${summary}`}
          accessibilityHint={expanded ? 'Hides each condition' : 'Shows each condition'}
          style={[
            styles.summary,
            expanded ? { borderBottomWidth: 1, borderBottomColor: t.colors.cardBorder } : undefined,
          ]}>
          <Icon
            name={allMet ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'}
            size={17}
            color={allMet ? t.colors.success : t.colors.warning}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text size="sm" weight="medium">
              {summary}
            </Text>
            {!allMet ? (
              <Text size="xs" tone="muted" numberOfLines={1}>
                Waiting on {pending.map((c) => c.type).join(', ')}
              </Text>
            ) : null}
          </View>
          <Animated.View style={chevron}>
            <Icon name="chevron.down" size={13} color={t.colors.mutedForeground} weight="semibold" />
          </Animated.View>
        </PressableScale>
        {expanded
          ? conditions.map((c, i) => (
              <Animated.View key={c.type} entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
                <CardField
                  layout="stacked"
                  separator={i < conditions.length - 1}
                  label={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Icon
                        name={c.status === 'True' ? 'checkmark.circle.fill' : 'circle.dashed'}
                        size={15}
                        color={c.status === 'True' ? t.colors.success : t.colors.mutedForeground}
                      />
                      <Text size="sm" weight="medium">
                        {c.type}
                      </Text>
                      <StatusBadge status={conditionStatus(c)} label={c.reason || c.status} />
                    </View>
                  }
                  value={
                    c.message || c.lastTransitionTime ? (
                      <View style={{ gap: 2 }}>
                        {c.message ? (
                          <Text size="xs" tone="muted" selectable>
                            {c.message}
                          </Text>
                        ) : null}
                        {c.lastTransitionTime ? (
                          <Text size="xs" tone="muted">
                            Changed {timeAgo(c.lastTransitionTime)}
                          </Text>
                        ) : null}
                      </View>
                    ) : undefined
                  }
                />
              </Animated.View>
            ))
          : null}
      </CardContent>
    </Card>
  );
}

const styles = StyleSheet.create({
  stackedValue: { alignSelf: 'stretch' },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    // Matches CardField in a size="sm" card, so the dividers line up.
    marginHorizontal: 16,
    paddingVertical: 14,
  },
});
