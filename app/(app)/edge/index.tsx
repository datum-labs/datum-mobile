import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { NoProjectState, QueryView } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { useSegment } from '@/hooks/useSegment';
import { pluralize } from '@/lib/format';
import { useDnsZones } from '@/resources/dns/queries';
import { useDomains } from '@/resources/domains/queries';
import type { HttpProxy } from '@/resources/http-proxies/model';
import { useHttpProxies } from '@/resources/http-proxies/queries';

const SEGMENTS = [
  { value: 'albs', label: 'ALBs' },
  { value: 'domains', label: 'Domains' },
  { value: 'dns', label: 'DNS Zones' },
] as const;
type Segment = (typeof SEGMENTS)[number]['value'];

function CertIcon({ proxy }: { proxy: HttpProxy }) {
  const t = useDatumTheme();
  if (proxy.view.certificates === 'ready')
    return <Icon name="lock.shield.fill" size={15} color={t.colors.success} accessibilityLabel="Certificates ready" />;
  if (proxy.view.certificates)
    return <Icon name="exclamationmark.shield.fill" size={15} color={t.colors.warning} accessibilityLabel="Certificates pending" />;
  return null;
}

export default function EdgeIndex() {
  const projectId = useProjectId();
  const [segment, setSegment] = useSegment<Segment>(
    SEGMENTS.map((s) => s.value),
    'albs'
  );
  const proxies = useHttpProxies(projectId);
  const domains = useDomains(projectId);
  const zones = useDnsZones(projectId);
  const active = segment === 'albs' ? proxies : segment === 'domains' ? domains : zones;

  return (
    <>
      <Stack.Screen options={{ title: 'Edge' }} />
      <Screen onRefresh={projectId ? () => active.refetch() : undefined}>
        <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
        {!projectId ? (
          <NoProjectState />
        ) : segment === 'albs' ? (
          <QueryView
            query={proxies}
            isEmpty={(d) => d.length === 0}
            empty={{
              title: 'No load balancers yet',
              description: 'ALBs you create in Datum Cloud show up here.',
            }}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((proxy, i) => (
                  <ResourceRow
                    key={proxy.uid}
                    index={i}
                    icon="arrow.triangle.branch"
                    title={proxy.displayName}
                    meta={proxy.canonicalHostname ?? proxy.hostnames[0]}
                    subtitle={
                      proxy.hostnames.length > 0
                        ? pluralize(proxy.hostnames.length, 'custom hostname')
                        : undefined
                    }
                    status={proxy.view}
                    trailing={<CertIcon proxy={proxy} />}
                    href={`/edge/alb/${encodeURIComponent(proxy.name)}`}
                  />
                ))}
              </View>
            )}
          </QueryView>
        ) : segment === 'domains' ? (
          <QueryView
            query={domains}
            isEmpty={(d) => d.length === 0}
            empty={{
              title: 'No domains yet',
              description: 'Verified domains let your ALBs serve custom hostnames.',
            }}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((domain, i) => (
                  <ResourceRow
                    key={domain.uid}
                    index={i}
                    icon="globe"
                    title={domain.domainName}
                    subtitle={domain.registrar ?? (domain.apex ? 'Apex domain' : undefined)}
                    status={domain.view}
                    href={`/edge/domains/${encodeURIComponent(domain.name)}`}
                  />
                ))}
              </View>
            )}
          </QueryView>
        ) : (
          <QueryView
            query={zones}
            isEmpty={(d) => d.length === 0}
            empty={{
              title: 'No DNS zones yet',
              description: 'Zones hosted on Datum DNS appear here with their records.',
            }}>
            {(items) => (
              <View style={{ gap: 8 }}>
                {items.map((zone, i) => (
                  <ResourceRow
                    key={zone.uid}
                    index={i}
                    icon="list.bullet.rectangle"
                    title={zone.domainName}
                    subtitle={
                      zone.recordCount !== undefined ? pluralize(zone.recordCount, 'record') : undefined
                    }
                    status={zone.view}
                    href={`/edge/dns/${encodeURIComponent(zone.name)}`}
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
