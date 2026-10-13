import { Card, CardContent, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { PATCH_ICON } from '@/components/assistant/askPatch';
import { Icon } from '@/components/Icon';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { NoProjectState } from '@/components/states';
import { SummaryTile } from '@/components/SummaryTile';
import { useProjectContext } from '@/context/ProjectContext';
import { attentionItems } from '@/lib/health/attention';
import { instanceView, rollup, workloadView } from '@/lib/status/views';
import { useConnectors } from '@/resources/connectors/queries';
import { useInstances, useWorkloads } from '@/resources/compute/queries';
import { useDnsZones } from '@/resources/dns/queries';
import { useDomains } from '@/resources/domains/queries';
import { useHttpProxies } from '@/resources/http-proxies/queries';
import { useNetworks } from '@/resources/networks/queries';

export default function Home() {
  const t = useDatumTheme();
  const { selection, hydrated, select } = useProjectContext();
  const projectId = selection?.projectId;

  // Deep link: `<scheme>:/home?org=<org>&project=<project>` opens that project.
  // Access is still enforced by the API; this only changes what we look at.
  const link = useLocalSearchParams<{ org?: string; project?: string }>();
  useEffect(() => {
    if (!hydrated || !link.org || !link.project) return;
    if (selection?.orgId === link.org && selection.projectId === link.project) return;
    select({ orgId: link.org, projectId: link.project });
  }, [hydrated, link.org, link.project, selection, select]);

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
        label: 'Networks',
        icon: 'point.3.filled.connected.trianglepath.dotted' as const,
        q: networks,
        counts: networks.data && rollup(networks.data.map((n) => n.view)),
        href: { pathname: '/(network)/network', params: { segment: 'networks' } } as Href,
      },
      {
        label: 'Connectors',
        icon: 'cable.connector' as const,
        q: connectors,
        counts: connectors.data && rollup(connectors.data.map((c) => c.view)),
        href: { pathname: '/(network)/network', params: { segment: 'connectors' } } as Href,
      },
    ],
    [proxies, domains, zones, workloads, instances, networks, connectors]
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

  return (
    <>
      <Stack.Screen options={{ title: selection?.projectName ?? 'Home' }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={PATCH_ICON}
          iconRenderingMode="template"
          accessibilityLabel="Ask Patch"
          onPress={() => router.push('/assistant')}
        />
        <Stack.Toolbar.Button
          icon="arrow.left.arrow.right"
          accessibilityLabel="Switch project"
          onPress={() => router.push('/context-switcher')}
        />
      </Stack.Toolbar>
      <Screen
        onRefresh={projectId ? () => Promise.all(tiles.map((tile) => tile.q.refetch())) : undefined}>
        {!projectId ? (
          hydrated ? (
            <NoProjectState />
          ) : null
        ) : (
          <>
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
                attention.map((item, i) => (
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
                ))
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
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  healthy: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
