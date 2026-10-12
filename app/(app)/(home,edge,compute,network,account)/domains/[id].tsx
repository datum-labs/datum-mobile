import { Card, CardContent, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { DetailHeader } from '@/components/DetailHeader';
import { ConditionsCard, InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { ErrorState, RowSkeletons } from '@/components/states';
import { useProjectId } from '@/context/ProjectContext';
import { formatDate } from '@/lib/format';
import { useDomain } from '@/resources/domains/queries';

export default function DomainDetail() {
  const t = useDatumTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = useProjectId();
  const query = useDomain(projectId, id);
  const domain = query.data;
  const verified = domain?.view.status === 'success';

  return (
    <>
      <Stack.Screen options={{ title: domain?.domainName ?? 'Domain' }} />
      <Screen onRefresh={() => query.refetch()}>
        {!domain ? (
          query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <RowSkeletons count={3} />
          )
        ) : (
          <>
            <DetailHeader icon="globe" title={domain.domainName} status={domain.view} />
            {!verified && (domain.verificationRecord || domain.verificationHttp) ? (
              <Section title="Verify ownership">
                <Card size="sm">
                  <CardContent style={{ gap: 10 }}>
                    {domain.verificationRecord ? (
                      <View style={{ gap: 4 }}>
                        <Text size="sm" weight="medium">
                          Add a DNS record
                        </Text>
                        <View style={{ backgroundColor: t.colors.muted, borderRadius: 10, padding: 10, gap: 2 }}>
                          <Text size="xs" mono selectable>
                            {domain.verificationRecord.name}
                          </Text>
                          <Text size="xs" mono selectable>
                            {domain.verificationRecord.type} {domain.verificationRecord.content}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                    {domain.verificationHttp ? (
                      <View style={{ gap: 4 }}>
                        <Text size="sm" weight="medium">
                          Or serve this file
                        </Text>
                        <Text size="xs" mono selectable tone="muted">
                          {domain.verificationHttp.url}
                        </Text>
                      </View>
                    ) : null}
                  </CardContent>
                </Card>
              </Section>
            ) : null}
            <Section title="Registration">
              <InfoCard
                rows={[
                  { label: 'Registrar', value: domain.registrar },
                  { label: 'Expires', value: domain.expiresAt ? formatDate(domain.expiresAt) : undefined },
                  {
                    label: 'Nameservers',
                    value: domain.nameservers.length ? domain.nameservers.join('\n') : undefined,
                    mono: true,
                  },
                  { label: 'Created', value: formatDate(domain.createdAt) },
                ]}
              />
            </Section>
            <Section title="Conditions">
              <ConditionsCard conditions={domain.conditions} />
            </Section>
          </>
        )}
      </Screen>
    </>
  );
}
