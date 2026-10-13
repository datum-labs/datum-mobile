import { Text, useDatumTheme, withAlpha } from '@datum-cloud/datum-ui-native';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { describeError } from '@/api';
import { isActive } from '@/resources/connect/model';
import { useVpnState } from '@/resources/connect/queries';
import { connectService } from '@/resources/connect/service';
import { useNetworks } from '@/resources/networks/queries';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { ResourceRow } from './ResourceRow';
import { Section } from './Section';
import { RowSkeletons } from './states';

const MAX_ROWS = 4;

/** "New private network" call to action: opens the create sheet. */
export function NewNetworkCard({ index = 0, prominent = false }: { index?: number; prominent?: boolean }) {
  const t = useDatumTheme();
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 12) * 35).duration(320)}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="New private network"
        onPress={() => router.push('/new-network')}
        style={[
          styles.cta,
          {
            borderColor: withAlpha(t.colors.primary, prominent ? 0.5 : 0.3),
            backgroundColor: withAlpha(t.colors.primary, prominent ? 0.1 : 0.05),
          },
        ]}>
        <View style={[styles.ctaIcon, { backgroundColor: t.colors.primary }]}>
          <Icon name="plus" size={17} color={t.colors.primaryForeground} weight="bold" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="base" weight="medium">
            New private network
          </Text>
          <Text size="xs" tone="muted">
            {prominent
              ? 'Create a VPC for your workloads and connect this iPhone to it.'
              : 'Create a VPC and connect straight away.'}
          </Text>
        </View>
        <Icon name="chevron.right" size={13} color={t.colors.mutedForeground} />
      </PressableScale>
    </Animated.View>
  );
}

/** Home's first section: the project's networks, which one this iPhone is on, and the create CTA. */
export function HomeNetworks({ projectId }: { projectId: string }) {
  const t = useDatumTheme();
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
        <>
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
                  <View style={[styles.joined, { backgroundColor: withAlpha(t.colors.success, 0.15) }]}>
                    <Icon name="iphone.gen3.radiowaves.left.and.right" size={12} color={t.colors.success} />
                    <Text size="xs" weight="medium" style={{ color: t.colors.success }}>
                      {vpn?.status === 'connected' ? 'Connected' : 'Connecting'}
                    </Text>
                  </View>
                ) : undefined
              }
              href={`/networks/${encodeURIComponent(n.name)}`}
            />
          ))}
          <NewNetworkCard index={shown.length} prominent={items.length === 0} />
        </>
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
    paddingVertical: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  ctaIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  joined: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
});
