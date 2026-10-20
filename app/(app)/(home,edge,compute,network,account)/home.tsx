import { CardContent, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router, Stack, useIsFocused, useLocalSearchParams, type Href } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useDerivedValue,
  useScrollViewOffset,
} from 'react-native-reanimated';
import type Animated from 'react-native-reanimated';
import { Platform, StyleSheet, View } from 'react-native';

import { PATCH_ICON } from '@/components/assistant/askPatch';
import { HomeHero, HomeHeroPanel, type HomeHeroSummary } from '@/components/HomeHero';
import { HomeNetworks } from '@/components/HomeNetworks';
import { Icon } from '@/components/Icon';
import { Card, RowGroup } from '@/components/Grouped';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { NoProjectState } from '@/components/states';
import { SummaryTile } from '@/components/SummaryTile';
import { useProjectContext } from '@/context/ProjectContext';
import { attentionItems } from '@/lib/health/attention';
import { instanceView, rollup, workloadView } from '@/lib/status/views';
import { useConnectors } from '@/resources/connectors/queries';
import { usePublishProjectHealth } from '@/resources/widgets/hooks';
import { useInstances, useWorkloads } from '@/resources/compute/queries';
import { useDnsZones } from '@/resources/dns/queries';
import { useDomains } from '@/resources/domains/queries';
import { useHttpProxies } from '@/resources/http-proxies/queries';
import { useNetworks } from '@/resources/networks/queries';
import { useToolbarIcon } from '@/lib/icons/toolbar';

export default function Home() {
  const toolbarIcon = useToolbarIcon();
  const t = useDatumTheme();
  const { selection, hydrated } = useProjectContext();
  const projectId = selection?.projectId;

  // Deep link: `<scheme>:/home?org=<org>&project=<project>` opens that project
  // (selected in useWidgetLinks, for every screen).
  const link = useLocalSearchParams<{ project?: string }>();

  // First launch (or the project went away): go straight to the switcher.
  const prompted = useRef(false);
  useEffect(() => {
    if (hydrated && !selection && !link.project && !prompted.current) {
      prompted.current = true;
      router.push('/context-switcher');
    }
  }, [hydrated, selection, link.project]);

  const proxies = useHttpProxies(projectId);
  const domains = useDomains(projectId);
  const zones = useDnsZones(projectId);
  const workloads = useWorkloads(projectId);
  const instances = useInstances(projectId);
  const networks = useNetworks(projectId);
  const connectors = useConnectors(projectId);

  const tiles = useMemo(
    () => [
      {
        label: 'Load balancers',
        icon: 'arrow.triangle.branch' as const,
        q: proxies,
        counts: proxies.data && rollup(proxies.data.map((p) => p.view)),
        href: { pathname: '/(edge)/edge', params: { segment: 'albs' } } as Href,
      },
      {
        label: 'Domains',
        icon: 'globe' as const,
        q: domains,
        counts: domains.data && rollup(domains.data.map((d) => d.view)),
        href: { pathname: '/(edge)/edge', params: { segment: 'domains' } } as Href,
      },
      {
        label: 'DNS zones',
        icon: 'list.bullet.rectangle' as const,
        q: zones,
        counts: zones.data && rollup(zones.data.map((z) => z.view)),
        href: { pathname: '/(edge)/edge', params: { segment: 'dns' } } as Href,
      },
      {
        label: 'Workloads',
        icon: 'shippingbox.fill' as const,
        q: workloads,
        counts: workloads.data && rollup(workloads.data.map((w) => workloadView(w))),
        href: { pathname: '/(compute)/compute', params: { segment: 'workloads' } } as Href,
      },
      {
        label: 'Instances',
        icon: 'cpu' as const,
        q: instances,
        counts: instances.data && rollup(instances.data.map(instanceView)),
        href: { pathname: '/(compute)/compute', params: { segment: 'instances' } } as Href,
      },
      {
        label: 'Connectors',
        icon: 'cable.connector' as const,
        q: connectors,
        counts: connectors.data && rollup(connectors.data.map((c) => c.view)),
        href: { pathname: '/(network)/network', params: { segment: 'connectors' } } as Href,
      },
    ],
    [proxies, domains, zones, workloads, instances, connectors]
  );

  const attention = useMemo(
    () =>
      attentionItems({
        proxies: proxies.data,
        workloads: workloads.data,
        domains: domains.data,
        zones: zones.data,
      }).slice(0, 6),
    [proxies.data, workloads.data, domains.data, zones.data]
  );

  const allLoaded = tiles.every((tile) => tile.q.data !== undefined || tile.q.error);

  // Artwork header: the hero scrolls under the transparent bar; once it's
  // gone, the project name moves into the bar and the status bar goes dark.
  const headerHeight = useHeaderHeight();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollViewOffset(scrollRef);
  // 0 at rest: iOS rests at -headerHeight (content inset); Android at 0 (padding).
  const restOffset = Platform.OS === 'ios' ? headerHeight : 0;
  const scrollY = useDerivedValue(() => offset.value + restOffset);
  const [collapsed, setCollapsed] = useState(false);
  useAnimatedReaction(
    () => scrollY.value > 120,
    (next, prev) => {
      if (next !== prev) runOnJS(setCollapsed)(next);
    }
  );
  const focused = useIsFocused();
  const onArt = !!projectId && !collapsed;
  const heroSummary: HomeHeroSummary | undefined =
    attention.length > 0
      ? {
          tone: attention.some((item) => item.view.status === 'error') ? 'error' : 'warning',
          label: `${attention.length} ${attention.length === 1 ? 'needs' : 'need'} attention`,
        }
      : allLoaded
        ? { tone: 'success', label: 'All healthy' }
        : undefined;

  // The widgets show what Home shows.
  usePublishProjectHealth(
    selection,
    { proxies: proxies.data, workloads: workloads.data, instances: instances.data, domains: domains.data, zones: zones.data },
    [proxies, workloads, instances, domains, zones].every((q) => q.data !== undefined || q.error)
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: projectId && !collapsed ? '' : (selection?.projectName ?? 'Home'),
          // The hero carries the big title.
          headerLargeTitle: !projectId,
          // Android's bar is opaque elsewhere; clear while it's over the artwork.
          // (Set both ways: dropping the option wouldn't restore the default.)
          ...(Platform.OS === 'android'
            ? { headerStyle: { backgroundColor: onArt ? 'transparent' : t.colors.background } }
            : {}),
        }}
      />
      {focused && onArt ? <StatusBar style="light" /> : null}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={PATCH_ICON}
          iconRenderingMode="template"
          accessibilityLabel="Ask Patch"
          tintColor={onArt ? '#fff' : undefined}
          onPress={() => router.push('/assistant')}
        />
        <Stack.Toolbar.Button
          icon={toolbarIcon('arrow.left.arrow.right')}
          accessibilityLabel="Switch project"
          tintColor={onArt ? '#fff' : undefined}
          onPress={() => router.push('/context-switcher')}
        />
      </Stack.Toolbar>
      <Screen
        scrollRef={scrollRef}
        refreshTint={onArt ? '#fff' : undefined}
        onRefresh={projectId ? () => Promise.all([networks.refetch(), ...tiles.map((tile) => tile.q.refetch())]) : undefined}>
        {!projectId ? (
          hydrated ? (
            <NoProjectState />
          ) : null
        ) : (
          <>
            <HomeHero
              title={selection?.projectName ?? projectId}
              subtitle={selection?.orgName}
              summary={heroSummary}
              headerHeight={headerHeight}
              scrollY={scrollY}
            />
            <HomeHeroPanel>
            <HomeNetworks projectId={projectId} />
            <View style={styles.grid}>
              {tiles.map((tile, i) => (
                <SummaryTile
                  key={tile.label}
                  index={i}
                  label={tile.label}
                  icon={tile.icon}
                  counts={tile.counts}
                  loading={tile.q.isPending}
                  failed={!!tile.q.error && tile.q.data === undefined}
                  // Singular: switch to the tab's existing root (updating its segment)
                  // instead of pushing a second copy with a back button.
                  onPress={() => router.navigate(tile.href, { dangerouslySingular: true })}
                />
              ))}
            </View>
            <Section title="Needs attention">
              {attention.length > 0 ? (
                <RowGroup>
                  {attention.map((item, i) => (
                    <ResourceRow
                      key={item.key}
                      index={i}
                      title={item.title}
                      subtitle={item.subtitle}
                      icon={item.icon}
                      status={item.view}
                      href={item.path as Href}
                      zoom={false}
                    />
                  ))}
                </RowGroup>
              ) : allLoaded ? (
                <Card size="sm">
                  <CardContent style={styles.healthy}>
                    <Icon name="checkmark.seal.fill" size={22} color={t.colors.success} />
                    <View style={{ flex: 1 }}>
                      <Text size="sm" weight="medium">
                        Everything looks healthy
                      </Text>
                      <Text size="xs" tone="muted">
                        No failing or pending resources in this project.
                      </Text>
                    </View>
                  </CardContent>
                </Card>
              ) : null}
            </Section>
            </HomeHeroPanel>
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -6 },
  healthy: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
