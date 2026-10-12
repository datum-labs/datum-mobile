import { Spinner, Text, Title, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutLeft } from 'react-native-reanimated';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { EmptyState, ErrorState, SCENES } from '@/components/states';
import { useProjectContext } from '@/context/ProjectContext';
import type { Organization } from '@/resources/organizations/service';
import { useOrganizations } from '@/resources/organizations/queries';
import { useProjects } from '@/resources/projects/queries';

function Row({
  title,
  subtitle,
  selected,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
  icon: 'building.2.fill' | 'folder.fill';
}) {
  const t = useDatumTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.row, { backgroundColor: selected ? t.colors.accent : 'transparent' }]}>
      <Icon name={icon} size={18} color={t.colors.primary} />
      <View style={{ flex: 1 }}>
        <Text size="base" weight="medium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text size="xs" tone="muted" mono numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Icon name="checkmark" size={15} color={t.colors.primary} weight="semibold" />
      ) : (
        <Icon name="chevron.right" size={13} color={t.colors.mutedForeground} />
      )}
    </PressableScale>
  );
}

/** Form sheet: pick an organization, then one of its projects. */
export default function ContextSwitcher() {
  const t = useDatumTheme();
  const { state } = useAuth();
  const { selection, select } = useProjectContext();
  const sub = state.status === 'signedIn' ? state.user.sub : undefined;
  const orgs = useOrganizations(sub);
  const [org, setOrg] = useState<Organization | null>(null);
  const projects = useProjects(org?.name);

  return (
    <View style={[styles.root, { backgroundColor: t.colors.background }]}>
      <View style={styles.header}>
        {org ? (
          <PressableScale onPress={() => setOrg(null)} accessibilityLabel="Back to organizations" style={styles.back}>
            <Icon name="chevron.left" size={16} color={t.colors.primary} weight="semibold" />
            <Text size="sm" tone="primary" weight="medium">
              Organizations
            </Text>
          </PressableScale>
        ) : null}
        <Title level={3}>{org ? org.displayName : 'Organizations'}</Title>
        <Text size="sm" tone="muted">
          {org ? 'Choose a project' : 'Choose where to look'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {!org ? (
          <Animated.View key="orgs" entering={FadeIn.duration(180)} exiting={SlideOutLeft.duration(200)}>
            {orgs.data ? (
              orgs.data.length === 0 ? (
                <EmptyState
                  title="No organizations"
                  description="Create an organization in Datum Cloud to get started."
                  image={SCENES.camp}
                />
              ) : (
                orgs.data.map((o) => (
                  <Row
                    key={o.name}
                    icon="building.2.fill"
                    title={o.displayName}
                    subtitle={o.type === 'Personal' ? 'Personal' : o.name}
                    selected={selection?.orgId === o.name}
                    onPress={() => setOrg(o)}
                  />
                ))
              )
            ) : orgs.error ? (
              <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
            ) : (
              <Spinner style={{ marginTop: 32 }} />
            )}
          </Animated.View>
        ) : (
          <Animated.View key={`projects-${org.name}`} entering={SlideInRight.duration(220)} exiting={FadeOut.duration(150)}>
            {projects.data ? (
              projects.data.length === 0 ? (
                <EmptyState
                  title="No projects"
                  description="This organization has no ready projects yet."
                  image={SCENES.ridge}
                />
              ) : (
                projects.data.map((p) => (
                  <Row
                    key={p.name}
                    icon="folder.fill"
                    title={p.displayName}
                    subtitle={p.name}
                    selected={selection?.projectId === p.name}
                    onPress={() => {
                      select({
                        orgId: org.name,
                        orgName: org.displayName,
                        projectId: p.name,
                        projectName: p.displayName,
                      });
                      router.back();
                    }}
                  />
                ))
              )
            ) : projects.error ? (
              <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
            ) : (
              <Spinner style={{ marginTop: 32 }} />
            )}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 12, gap: 4 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6, alignSelf: 'flex-start' },
  list: { paddingHorizontal: 12, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
});
