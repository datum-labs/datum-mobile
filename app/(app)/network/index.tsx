import { Stack } from 'expo-router';
import { View } from 'react-native';

import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { NoProjectState, QueryView, SCENES } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { useSegment } from '@/hooks/useSegment';
import { useConnectors } from '@/resources/connectors/queries';
import { useNetworks, useSubnets } from '@/resources/networks/queries';

const SEGMENTS = [
  { value: 'networks', label: 'Networks' },
  { value: 'subnets', label: 'Subnets' },
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
  const subnets = useSubnets(projectId);
  const connectors = useConnectors(projectId);
  const active = segment === 'networks' ? networks : segment === 'subnets' ? subnets : connectors;

  return (
    <>
      <Stack.Screen options={{ title: 'Network' }} />
      <Screen onRefresh={projectId ? () => active.refetch() : undefined}>
        <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
        {!projectId ? (
          <NoProjectState />
        ) : segment === 'networks' ? (
          <QueryView
            query={networks}
            isEmpty={(d) => d.length === 0}
            empty={{ title: 'No networks yet', description: 'Private networks your workloads attach to.', image: SCENES.trail }}>
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
                    href={`/network/${encodeURIComponent(n.name)}`}
                  />
                ))}
              </View>
            )}
          </QueryView>
        ) : segment === 'subnets' ? (
          <QueryView
            query={subnets}
            isEmpty={(d) => d.length === 0}
            empty={{ title: 'No subnets', description: 'Subnets are allocated per location as workloads deploy.', image: SCENES.ridge }}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((s, i) => (
                  <ResourceRow
                    key={s.uid}
                    index={i}
                    icon="square.split.bottomrightquarter"
                    title={s.name}
                    subtitle={[s.network, s.location].filter(Boolean).join(' · ')}
                    meta={s.cidr}
                    status={s.view}
                    href={s.network ? `/network/${encodeURIComponent(s.network)}` : undefined}
                  />
                ))}
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
              image: SCENES.flags,
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
                    href={`/network/connectors/${encodeURIComponent(c.name)}`}
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
