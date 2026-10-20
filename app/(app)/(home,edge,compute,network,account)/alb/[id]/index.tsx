import { CardContent, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AlbActiveRegions } from '@/components/alb/AlbActiveRegions';
import { AlbHealthCard } from '@/components/alb/AlbHealthCard';
import { AlbKpiStrip } from '@/components/alb/AlbKpiStrip';
import { WafCategoriesRow } from '@/components/alb/WafCategoriesRow';
import { ASK_PATCH, askPatchAbout } from '@/components/assistant/askPatch';
import { DetailHeader } from '@/components/DetailHeader';
import { HostnameLink, openHostname } from '@/components/HostnameLink';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { Card, RowGroup, StatusLabel } from '@/components/Grouped';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { isOpenableHostname } from '@/lib/hostnames';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate, timeAgo } from '@/lib/format';
import {
  getActionableRecordsToPublish,
  getCertificateReadyCondition,
  getCertificateReadyDisplay,
  getDnsRecordProgrammedCondition,
  getDnsRecordProgrammedDisplay,
  getDnsRecordProgrammedIssue,
  getHostnameOwnershipDisplay,
  WILDCARD_NOT_ENABLED_MESSAGE,
  type HostnameStatusLike,
} from '@/lib/status/http-proxy-conditions';
import type { StatusView } from '@/lib/status/types';
import type { HttpProxy, HttpProxyBackend } from '@/resources/http-proxies/model';
import { sensitivityLabel, wafStatusView } from '@/resources/http-proxies/model';
import { useWorkloads } from '@/resources/compute/queries';
import {
  albHealth,
  durationLabel,
  noteText,
  originTls,
  poolRows,
  wafCategoriesView,
  type OriginTls,
} from '@/resources/http-proxies/config';
import {
  useHttpProxy,
  useProxyBasicAuth,
  useProxyDescription,
  useProxyWaf,
} from '@/resources/http-proxies/queries';
import { useToolbarIcon } from '@/lib/icons/toolbar';

function certView(status: HostnameStatusLike | undefined): StatusView {
  const condition = getCertificateReadyCondition(status);
  switch (getCertificateReadyDisplay(condition)) {
    case 'ready':
      return { status: 'success', label: 'Issued' };
    case 'renewal-failing':
      return { status: 'pending', label: 'Renewal failing', detail: condition?.message };
    case 'failed':
      return { status: 'error', label: 'Failed', detail: condition?.message };
    case 'challenge':
      return { status: 'pending', label: 'Challenge', detail: condition?.message };
    case 'not-enabled':
      return { status: 'unknown', label: 'Not enabled', detail: WILDCARD_NOT_ENABLED_MESSAGE };
    case 'pending':
      return { status: 'pending', label: 'Pending', detail: condition?.message };
    default:
      return { status: 'unknown', label: 'Waiting' };
  }
}

function ownershipView(status: HostnameStatusLike | undefined): StatusView {
  const ownership = getHostnameOwnershipDisplay(status);
  const map = {
    verified: 'success',
    verifying: 'pending',
    unverified: 'error',
    'in-use': 'error',
    'dns-proof-required': 'error',
  } as const;
  return { status: map[ownership.state], label: ownership.label, detail: ownership.message };
}

function dnsView(status: HostnameStatusLike | undefined): StatusView {
  const condition = getDnsRecordProgrammedCondition(status);
  const issue = getDnsRecordProgrammedIssue(condition);
  if (issue) return { status: 'error', label: issue.label, detail: issue.message };
  switch (getDnsRecordProgrammedDisplay(condition)) {
    case 'programmed':
      return { status: 'success', label: 'Programmed' };
    case 'not-applicable':
      return { status: 'unknown', label: 'External DNS' };
    default:
      return { status: 'pending', label: 'Pending', detail: condition?.message };
  }
}

function CheckRow({ label, view }: { label: string; view: StatusView }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.checkRow}>
        <Text size="sm" tone="muted">
          {label}
        </Text>
        <StatusLabel status={view.status} label={view.label} />
      </View>
      {view.detail && view.status !== 'success' ? (
        <Text size="xs" tone="muted" selectable>
          {view.detail}
        </Text>
      ) : null}
    </View>
  );
}

function HostnameCard({ hostname, proxy }: { hostname: string; proxy: HttpProxy }) {
  const t = useDatumTheme();
  const status = proxy.hostnameStatuses.find((s) => s.hostname === hostname);
  const records = getActionableRecordsToPublish(status);
  return (
    <Card size="sm">
      <CardContent style={{ gap: 12 }}>
        <HostnameLink hostname={hostname} />
        <CheckRow label="Ownership" view={ownershipView(status)} />
        <CheckRow label="Certificate" view={certView(status)} />
        <CheckRow label="DNS" view={dnsView(status)} />
        {records.length > 0 ? (
          <View style={[styles.records, { backgroundColor: t.colors.muted }]}>
            <Text size="xs" weight="semibold">
              Publish {records.length === 1 ? 'this record' : 'these records'} at your DNS provider
            </Text>
            {records.map((r) => (
              <Text key={`${r.type}/${r.name}/${r.content}`} size="xs" mono selectable>
                {r.name} {r.type} {r.content}
              </Text>
            ))}
          </View>
        ) : null}
      </CardContent>
    </Card>
  );
}

function backendTitle(b: HttpProxyBackend): string {
  switch (b.kind) {
    case 'connector':
      return b.connector ?? 'Connector';
    case 'networkService':
      return `${b.networkService?.name ?? 'Network service'}${b.networkService?.port ? `:${b.networkService.port}` : ''}`;
    case 'instance':
      return `${b.instance?.name ?? 'Instance'}${b.instance?.port ? `:${b.instance.port}` : ''}`;
    default:
      return b.endpoint ?? 'Endpoint';
  }
}

const BACKEND_LABEL: Record<HttpProxyBackend['kind'], string> = {
  connector: 'Connector',
  networkService: 'Compute service',
  instance: 'Instance',
  endpoint: 'Origin',
};

function originTlsLabel(tls: OriginTls | undefined): string | undefined {
  switch (tls?.kind) {
    case 'override':
      return tls.hostname;
    case 'fromOrigin':
      return tls.hostname ? `${tls.hostname} (from origin URL)` : undefined;
    case 'perBackend':
      return 'Set per backend';
    case 'connector':
      return '—';
    default:
      return undefined;
  }
}

export default function AlbDetail() {
  const toolbarIcon = useToolbarIcon();
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const query = useHttpProxy(projectId, id);
  const waf = useProxyWaf(projectId, id);
  const proxy = query.data;
  const wafView = wafStatusView(waf.data);
  const basicAuth = useProxyBasicAuth(projectId, id);
  const description = useProxyDescription(projectId, id);
  const workloads = useWorkloads(projectId);
  const workloadMissing =
    !!proxy?.workloadName && !!workloads.data && !workloads.data.some((w) => w.name === proxy.workloadName);
  const wafOn = !!waf.data?.mode && waf.data.mode !== 'Disabled';

  return (
    <>
      <Stack.Screen options={{ title: proxy?.displayName ?? 'Load balancer' }} />
      {id ? (
        <Stack.Toolbar placement="right">
          {proxy?.canonicalHostname && isOpenableHostname(proxy.canonicalHostname) ? (
            <Stack.Toolbar.Button
              icon={toolbarIcon('safari')}
              accessibilityLabel={`Open ${proxy.canonicalHostname} in your browser`}
              onPress={() => void openHostname(proxy.canonicalHostname as string)}
            />
          ) : null}
          <Stack.Toolbar.Button
            {...ASK_PATCH}
            onPress={() => askPatchAbout('alb', id, proxy?.displayName)}
          />
        </Stack.Toolbar>
      ) : null}
      <Screen
        onRefresh={() =>
          Promise.all([query.refetch(), waf.refetch(), basicAuth.refetch(), description.refetch(), workloads.refetch()])
        }>
        {!proxy ? (
          query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <RowSkeletons count={4} />
          )
        ) : (
          <>
            <DetailHeader
              icon="arrow.triangle.branch"
              title={proxy.displayName}
              subtitle={proxy.canonicalHostname}
              status={proxy.view}
            />
            <AlbHealthCard health={albHealth(proxy, { workloadMissing })} />
            {projectId ? (
              <Section title="Last hour">
                <AlbKpiStrip
                  projectId={projectId}
                  proxyName={proxy.name}
                  onPress={() => router.push(`/alb/${encodeURIComponent(proxy.name)}/metrics`)}
                />
              </Section>
            ) : null}

            <Section title="Observability">
              <RowGroup>
              <ResourceRow
                icon="chart.xyaxis.line"
                title="Metrics"
                subtitle="Traffic, errors and latency"
                href={`/alb/${encodeURIComponent(proxy.name)}/metrics`}
              />
              <ResourceRow
                index={1}
                icon="doc.text.magnifyingglass"
                title="Access logs"
                subtitle="Requests through this load balancer"
                href={`/alb/${encodeURIComponent(proxy.name)}/logs`}
              />
              <ResourceRow
                index={2}
                icon="clock.arrow.circlepath"
                title="Activity"
                subtitle="Changes in the last 7 days"
                href={`/alb/${encodeURIComponent(proxy.name)}/activity`}
              />
              </RowGroup>
            </Section>

            {proxy.hostnames.length > 0 ? (
              <Section title="Hostnames">
                {proxy.hostnames.map((hostname) => (
                  <HostnameCard key={hostname} hostname={hostname} proxy={proxy} />
                ))}
              </Section>
            ) : null}

            <Section title="Backends">
              {proxy.backends.length === 0 ? (
                <Text size="sm" tone="muted">
                  No backends configured.
                </Text>
              ) : (
                <RowGroup>
                  {poolRows(proxy.backends).map((row, i) => (
                    <ResourceRow
                      key={`${row.backend.kind}/${i}`}
                      index={i}
                      icon={
                        row.backend.kind === 'connector'
                          ? 'cable.connector'
                          : row.backend.kind === 'endpoint'
                            ? 'server.rack'
                            : 'shippingbox.fill'
                      }
                      title={backendTitle(row.backend)}
                      subtitle={`${BACKEND_LABEL[row.backend.kind]} · ${row.transport}`}
                      trailing={
                        proxy.backends.length > 1 ? (
                          <Text size="sm" weight="medium" tone={row.weight === 0 ? 'muted' : undefined}>
                            {row.share}
                          </Text>
                        ) : undefined
                      }
                      href={
                        row.backend.kind === 'connector' && row.backend.connector
                          ? `/connectors/${encodeURIComponent(row.backend.connector)}`
                          : undefined
                      }
                    />
                  ))}
                </RowGroup>
              )}
              <InfoCard
                rows={[
                  { label: 'Load balancing', value: proxy.loadBalancing },
                  { label: 'Outlier detection', value: proxy.healthCheck.enabled ? 'On' : 'Off' },
                  proxy.healthCheck.enabled
                    ? { label: 'Eject after', value: `${proxy.healthCheck.consecutive5xxErrors} consecutive 5xx responses` }
                    : null,
                  proxy.healthCheck.enabled
                    ? {
                        label: 'Ejection time',
                        value: `${durationLabel(proxy.healthCheck.baseEjectionTime)}, longer on each repeat`,
                      }
                    : null,
                  proxy.healthCheck.enabled
                    ? { label: 'Max ejected', value: `${proxy.healthCheck.maxEjectionPercent}% of a backend's endpoints` }
                    : { label: 'Effect', value: 'Endpoints keep receiving traffic even while they return errors' },
                ]}
              />
            </Section>

            {projectId ? (
              <Section title="Regions">
                <AlbActiveRegions projectId={projectId} proxyName={proxy.name} />
              </Section>
            ) : null}

            <Section title="Security & WAF">
              <InfoCard
                rows={[
                  {
                    label: 'Protection',
                    value: wafView ? (
                      <StatusLabel status={wafView.status} label={wafView.label} />
                    ) : waf.error ? (
                      '—'
                    ) : (
                      'Loading…'
                    ),
                  },
                  waf.data?.mode ? { label: 'Mode', value: waf.data.mode } : null,
                  // Named like the portal's "Sensitivity" (OWASP CRS paranoia level).
                  wafOn ? { label: 'Sensitivity', value: sensitivityLabel(waf.data?.paranoia?.blocking) } : null,
                  // The portal keeps detection equal to blocking; only call it out when it differs.
                  wafOn &&
                  waf.data?.paranoia?.detection &&
                  waf.data.paranoia.detection !== (waf.data.paranoia.blocking ?? 1)
                    ? { label: 'Also logging', value: sensitivityLabel(waf.data.paranoia.detection) }
                    : null,
                  wafOn
                    ? {
                        label: 'Rule categories',
                        stacked: true,
                        value: <WafCategoriesRow view={wafCategoriesView(waf.data?.excludedTags ?? [])} />,
                      }
                    : null,
                  wafView?.detail ? { label: 'Status', value: wafView.detail } : null,
                ]}
              />
            </Section>

            <Section title="Access">
              <InfoCard
                rows={[
                  {
                    label: 'Basic authentication',
                    value:
                      basicAuth.data === 'enabled'
                        ? 'Enabled'
                        : basicAuth.data === 'disabled'
                          ? 'Disabled'
                          : basicAuth.data === 'forbidden'
                            ? 'No access'
                            : basicAuth.error
                              ? '—'
                              : 'Loading…',
                  },
                  {
                    label: 'Host header',
                    value: proxy.hostHeader ?? 'Forwarded unchanged',
                    mono: !!proxy.hostHeader,
                  },
                ]}
              />
            </Section>

            <Section title="TLS">
              <InfoCard
                rows={[
                  { label: 'Force HTTPS', value: proxy.enableHttpRedirect ? 'On' : 'Off' },
                  { label: 'HSTS', value: proxy.hsts ? 'Enabled' : 'Disabled' },
                  {
                    label: 'Origin TLS hostname',
                    value: originTlsLabel(originTls(proxy.backends)),
                  },
                ]}
              />
            </Section>

            <Section title="Details">
              <InfoCard
                rows={[
                  { label: 'Name', value: proxy.name, mono: true },
                  description.data?.content
                    ? { label: 'Description', value: noteText(description.data.content), stacked: true }
                    : null,
                  {
                    label: 'Default hostname',
                    stacked: true,
                    value: proxy.canonicalHostname ? (
                      <HostnameLink hostname={proxy.canonicalHostname} size="sm" />
                    ) : undefined,
                  },
                  proxy.workloadName ? { label: 'Workload', value: proxy.workloadName } : null,
                  { label: 'Created', value: formatDate(proxy.createdAt) },
                  proxy.updatedAt ? { label: 'Last updated', value: timeAgo(proxy.updatedAt) } : null,
                ]}
              />
            </Section>

            <Section title="Conditions">
              <ConditionsCard conditions={proxy.conditions} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  records: { borderRadius: 10, padding: 10, gap: 4 },
});
