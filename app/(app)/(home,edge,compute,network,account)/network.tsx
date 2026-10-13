import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { NewNetworkCard } from '@/components/HomeNetworks';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { NoProjectState, QueryView } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { useSegment } from '@/hooks/useSegment';
import { useConnectors } from '@/resources/connectors/queries';
import { useNetworks } from '@/resources/networks/queries';

const SEGMENTS = [
  { value: 'networks', label: 'Networks' },
  { value: 'connectors', label: 'Connectors' },
] as const;
type Segment = (typeof SEGMENTS)[number]['value'];

export default function NetworkIndex() {
  const projectId = useProjectId();
  const [segment, setSegment] = useSegment<Segment>(
    SEGMENTS.map((s) => s.value),
    'networks'
  );
  const networks = useNetworks(projectId);
  const connectors = useConnectors(projectId);
  const active = segment === 'networks' ? networks : connectors;

  return (
    <>
      <Stack.Screen options={{ title: 'Network' }} />
      {projectId ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel="New private network"
            onPress={() => router.push('/new-network')}
          />
        </Stack.Toolbar>
      ) : null}
      <Screen onRefresh={projectId ? () => active.refetch() : undefined}>
        <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
        {!projectId ? (
          <NoProjectState />
        ) : segment === 'networks' ? (
          <QueryView
            query={networks}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((n, i) => (
                  <ResourceRow
                    key={n.uid}
                    index={i}
                    icon="point.3.filled.connected.trianglepath.dotted"
                    title={n.displayName}
                    subtitle={[n.ipamMode ? `IPAM ${n.ipamMode}` : undefined, n.ipFamilies.join(' + ')]
                      .filter(Boolean)
                      .join(' · ')}
                    meta={n.ipv4Range ?? n.ipv6Range ?? n.ipv6Prefix}
                    status={n.view}
                    href={`/networks/${encodeURIComponent(n.name)}`}
                  />
                ))}
                <NewNetworkCard index={items.length} prominent={items.length === 0} />
              </View>
            )}
          </QueryView>
        ) : (
          <QueryView
            query={connectors}
            isEmpty={(d) => d.length === 0}
            empty={{
              title: 'No connectors yet',
              description: 'Datum Desktop and datum-connect devices show up here once registered.',
            }}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((c, i) => (
                  <ResourceRow
                    key={c.uid}
                    index={i}
                    icon="cable.connector"
                    title={c.deviceName ?? c.name}
                    subtitle={[c.deviceOs, c.className].filter(Boolean).join(' · ')}
                    status={c.view}
                    href={`/connectors/${encodeURIComponent(c.name)}`}
                  />
                ))}
              </View>
            )}
          </QueryView>
        )}
      </Screen>
    </>
  );
}
