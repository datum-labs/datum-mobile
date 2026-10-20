import { impactHaptic, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { describeError } from '@/api';
import { isActive, THIS_DEVICE } from '@/resources/connect/model';
import { useVpnState } from '@/resources/connect/queries';
import { connectService } from '@/resources/connect/service';
import { useNetworks } from '@/resources/networks/queries';

import { groupedSurface, RowGroup, StatusLabel, useInRowGroup } from './Grouped';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { ResourceRow } from './ResourceRow';
import { Section } from './Section';
import { RowSkeletons } from './states';

const MAX_ROWS = 4;

/**
 * "New private network": the last row of the networks group, like an "Add…"
 * row in Settings; on its own (no networks yet) a card that says what it does.
 */
export function NewNetworkCard({ index = 0, prominent = false }: { index?: number; prominent?: boolean }) {
  const t = useDatumTheme();
  const grouped = useInRowGroup();
  const open = () => {
    impactHaptic('light');
    router.push('/new-network');
  };
  const body = (
    <View style={styles.cta}>
      <View style={[styles.ctaIcon, { backgroundColor: t.colors.primary }]}>
        <Icon name="plus" size={16} color={t.colors.primaryForeground} weight="bold" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text size="base" weight="medium" tone="primary">
          New private network
        </Text>
        {prominent ? (
          <Text size="sm" tone="muted">
            Create a VPC for your workloads and connect {THIS_DEVICE} to it.
          </Text>
        ) : null}
      </View>
    </View>
  );
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 12) * 35).duration(320)}>
      {grouped ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New private network"
          onPress={open}
          style={({ pressed }) => (pressed ? { backgroundColor: t.colors.muted } : null)}>
          {body}
        </Pressable>
      ) : (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="New private network"
          haptic={false}
          onPress={open}
          style={[groupedSurface, { backgroundColor: t.colors.card }]}>
          {body}
        </PressableScale>
      )}
    </Animated.View>
  );
}

/** Home's first section: the project's networks, which one this iPhone is on, and the create CTA. */
export function HomeNetworks({ projectId }: { projectId: string }) {
  const networks = useNetworks(projectId);
  const canConnect = useMemo(() => connectService.availability().available, []);
  const vpn = useVpnState(canConnect).data;
  const joined = vpn && isActive(vpn.status) && vpn.project === projectId ? vpn.network : undefined;

  const items = networks.data ?? [];
  // The network this iPhone is on comes first.
  const sorted = joined ? [...items].sort((a, b) => Number(b.name === joined) - Number(a.name === joined)) : items;
  const shown = sorted.slice(0, MAX_ROWS);

  return (
    <Section
      title="Networks"
      action={
        items.length > MAX_ROWS ? (
          <PressableScale
            accessibilityRole="button"
            onPress={() =>
              router.navigate({ pathname: '/(network)/network', params: { segment: 'networks' } } as Href, {
                dangerouslySingular: true,
              })
            }>
            <Text size="sm" tone="primary" weight="medium">
              See all {items.length}
            </Text>
          </PressableScale>
        ) : undefined
      }>
      {networks.data === undefined ? (
        networks.error ? (
          <Text size="sm" tone="muted" style={{ paddingHorizontal: 4 }}>
            Couldn&apos;t load networks: {describeError(networks.error)}
          </Text>
        ) : (
          <RowSkeletons count={2} />
        )
      ) : (
        <RowGroup>
          {shown.map((n, i) => (
            <ResourceRow
              key={n.uid}
              index={i}
              icon="point.3.filled.connected.trianglepath.dotted"
              title={n.displayName}
              subtitle={n.ipv6Prefix ?? n.ipFamilies.join(' + ')}
              status={n.name === joined ? undefined : n.view}
              trailing={
                n.name === joined ? (
                  <StatusLabel
                    status={vpn?.status === 'connected' ? 'success' : 'pending'}
                    label={vpn?.status === 'connected' ? 'Connected' : 'Connecting'}
                  />
                ) : undefined
              }
              href={`/networks/${encodeURIComponent(n.name)}`}
            />
          ))}
          <NewNetworkCard index={shown.length} prominent={items.length === 0} />
        </RowGroup>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 60,
  },
  ctaIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
