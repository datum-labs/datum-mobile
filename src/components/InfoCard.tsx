import { Card, CardContent, CardField, StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { timeAgo } from '@/lib/format';
import type { Condition } from '@/resources/shared';

import { Icon } from './Icon';

export type InfoRow = { label: string; value?: ReactNode; mono?: boolean } | false | null | undefined;

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
              value={
                <Text
                  size="sm"
                  mono={row.mono}
                  selectable
                  numberOfLines={3}
                  style={{ textAlign: 'right' }}>
                  {String(row.value)}
                </Text>
              }
            />
          ) : (
            <CardField key={row.label} label={row.label} value={row.value} />
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

/** Raw status conditions, for the curious (and support). */
export function ConditionsCard({ conditions }: { conditions: Condition[] }) {
  const t = useDatumTheme();
  if (conditions.length === 0) return null;
  return (
    <Card size="sm" sectioned>
      <CardContent padding="none">
        {conditions.map((c) => (
          <CardField
            key={c.type}
            layout="stacked"
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
        ))}
      </CardContent>
    </Card>
  );
}
