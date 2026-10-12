import { Card, CardContent, StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { DetailHeader } from '@/components/DetailHeader';
import { HostnameLink, openHostname } from '@/components/HostnameLink';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { isOpenableHostname } from '@/lib/hostnames';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
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
import { wafStatusView } from '@/resources/http-proxies/model';
import { useHttpProxy, useProxyWaf } from '@/resources/http-proxies/queries';

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
        <StatusBadge status={view.status} label={view.label} />
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

export default function AlbDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const query = useHttpProxy(projectId, id);
  const waf = useProxyWaf(projectId, id);
  const proxy = query.data;
  const wafView = wafStatusView(waf.data);

  return (
    <>
      <Stack.Screen options={{ title: proxy?.displayName ?? 'Load balancer' }} />
      {proxy?.canonicalHostname && isOpenableHostname(proxy.canonicalHostname) ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="safari"
            accessibilityLabel={`Open ${proxy.canonicalHostname} in your browser`}
            onPress={() => void openHostname(proxy.canonicalHostname as string)}
          />
        </Stack.Toolbar>
      ) : null}
      <Screen onRefresh={() => Promise.all([query.refetch(), waf.refetch()])}>
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
              status={proxy.view}>
              {proxy.view.retryRef ? (
                <Text size="xs" tone="muted">
                  Support reference: {proxy.view.retryRef}
                </Text>
              ) : null}
            </DetailHeader>

            <Section title="Logs">
              <ResourceRow
                icon="doc.text.magnifyingglass"
                title="Access logs"
                subtitle="Requests through this load balancer"
                href={`/edge/alb/${encodeURIComponent(proxy.name)}/logs`}
              />
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
                proxy.backends.map((b, i) => (
                  <ResourceRow
                    key={`${b.kind}/${i}`}
                    index={i}
                    icon={
                      b.kind === 'connector'
                        ? 'cable.connector'
                        : b.kind === 'endpoint'
                          ? 'server.rack'
                          : 'shippingbox.fill'
                    }
                    title={backendTitle(b)}
                    subtitle={[BACKEND_LABEL[b.kind], b.tlsHostname ? `TLS ${b.tlsHostname}` : undefined]
                      .filter(Boolean)
                      .join(' · ')}
                    href={
                      b.kind === 'connector' && b.connector
                        ? `/network/connectors/${encodeURIComponent(b.connector)}`
                        : undefined
                    }
                  />
                ))
              )}
            </Section>

            <Section title="Web application firewall">
              <InfoCard
                rows={[
                  {
                    label: 'Protection',
                    value: wafView ? (
                      <StatusBadge status={wafView.status} label={wafView.label} />
                    ) : waf.error ? (
                      '—'
                    ) : (
                      'Loading…'
                    ),
                  },
                  waf.data?.mode ? { label: 'Mode', value: waf.data.mode } : null,
                  waf.data?.paranoia?.blocking
                    ? { label: 'Blocking paranoia', value: `PL${waf.data.paranoia.blocking}` }
                    : null,
                  waf.data?.paranoia?.detection
                    ? { label: 'Detection paranoia', value: `PL${waf.data.paranoia.detection}` }
                    : null,
                  wafView?.detail ? { label: 'Status', value: wafView.detail } : null,
                ]}
              />
            </Section>

            <Section title="Details">
              <InfoCard
                rows={[
                  { label: 'Name', value: proxy.name, mono: true },
                  {
                    label: 'Default hostname',
                    value: proxy.canonicalHostname ? (
                      <HostnameLink hostname={proxy.canonicalHostname} size="sm" />
                    ) : undefined,
                  },
                  { label: 'HTTP → HTTPS', value: proxy.enableHttpRedirect ? 'Redirect' : 'Off' },
                  proxy.workloadName ? { label: 'Workload', value: proxy.workloadName } : null,
                  { label: 'Created', value: formatDate(proxy.createdAt) },
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
