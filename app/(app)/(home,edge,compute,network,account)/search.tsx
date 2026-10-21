import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Stack, useLocalSearchParams, useNavigation, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { RowGroup } from '@/components/Grouped';
import { Icon } from '@/components/Icon';
import { ResourceRow } from '@/components/ResourceRow';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { NoProjectState, RowSkeletons } from '@/components/states';
import { useProjectContext } from '@/context/ProjectContext';
import { useInstances, useWorkloads } from '@/resources/compute/queries';
import { useConnectors } from '@/resources/connectors/queries';
import { useDnsZones } from '@/resources/dns/queries';
import { useDomains } from '@/resources/domains/queries';
import { useHttpProxies } from '@/resources/http-proxies/queries';
import { useNetworks } from '@/resources/networks/queries';
import { SEARCH_GROUPS, searchResults, type SearchItem } from '@/resources/search/model';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue, useProjectSearch } from '@/resources/search/queries';
import { useSearchRecents } from '@/resources/search/recents';

/** The native stack's transition event, which useNavigation's type doesn't list. */
interface TransitionEvents {
  addListener(type: 'transitionEnd', listener: (e: { data: { closing: boolean } }) => void): () => void;
}

const ICON = Object.fromEntries(SEARCH_GROUPS.map((g) => [g.kind, g.icon])) as Record<
  SearchItem['kind'],
  (typeof SEARCH_GROUPS)[number]['icon']
>;

/**
 * Project search, as the portal's project search bar: Milo's search index
 * for load balancers, domains and DNS zones, plus the project's own lists
 * for everything else, grouped by kind. Before typing: recent searches and
 * recently opened results.
 */
export default function Search() {
  const t = useDatumTheme();
  const { selection } = useProjectContext();
  const projectId = selection?.projectId;
  // `/search?q=…` (a link, or a smoke test) opens with that query.
  const { q: initial } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(typeof initial === 'string' ? initial : '');
  const searchBar = useRef<SearchBarCommands>(null);
  // Focus the field (keyboard up) once the push has landed: `autoFocus`
  // alone fires before the header's search bar is ready on a push.
  const navigation = useNavigation() as unknown as TransitionEvents;
  useEffect(() => {
    if (initial) return;
    const focus = () => searchBar.current?.focus();
    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (!e.data.closing) focus();
    });
    // In case there's no transition (e.g. reduced motion, or opened by a link).
    const fallback = setTimeout(focus, 600);
    return () => {
      unsubscribe();
      clearTimeout(fallback);
    };
  }, [navigation, initial]);
  useEffect(() => {
    if (typeof initial !== 'string' || !initial) return;
    // The header's search bar mounts after this screen does.
    const timer = setTimeout(() => searchBar.current?.setText(initial), 300);
    return () => clearTimeout(timer);
  }, [initial]);
  const runRecent = (q: string) => {
    searchBar.current?.setText(q);
    setQuery(q);
  };
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const searching = debounced.trim().length > 0;

  const search = useProjectSearch(projectId, debounced);
  const proxies = useHttpProxies(projectId);
  const domains = useDomains(projectId);
  const zones = useDnsZones(projectId);
  const workloads = useWorkloads(projectId);
  const instances = useInstances(projectId);
  const networks = useNetworks(projectId);
  const connectors = useConnectors(projectId);
  const { recents, addQuery, addItem, clear } = useSearchRecents(projectId);

  const groups = useMemo(
    () =>
      searching
        ? searchResults(debounced, search.data, {
            proxies: proxies.data,
            domains: domains.data,
            zones: zones.data,
            workloads: workloads.data,
            instances: instances.data,
            networks: networks.data,
            connectors: connectors.data,
          })
        : [],
    [
      searching,
      debounced,
      search.data,
      proxies.data,
      domains.data,
      zones.data,
      workloads.data,
      instances.data,
      networks.data,
      connectors.data,
    ]
  );
  const listsLoading = [proxies, domains, zones, workloads, instances, networks, connectors].some(
    (q) => q.data === undefined && q.isPending
  );

  const open = (item: SearchItem) => {
    addQuery(debounced);
    addItem(item);
  };

  const row = (item: SearchItem, i: number) => (
    <ResourceRow
      key={item.key}
      index={i}
      icon={ICON[item.kind]}
      title={item.title}
      subtitle={item.subtitle}
      status={item.status}
      href={item.href as Href}
      onSelect={() => open(item)}
    />
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Search',
          headerSearchBarOptions: {
            ref: searchBar,
            placeholder: 'Load balancers, workloads, domains…',
            autoFocus: !initial,
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <Screen>
        {!projectId ? (
          <NoProjectState />
        ) : !searching ? (
          recents.queries.length === 0 && recents.items.length === 0 ? (
            <Text size="sm" tone="muted" style={styles.hint}>
              Search load balancers, domains, DNS zones, workloads, instances, networks and connectors in{' '}
              {selection?.projectName ?? projectId}.
            </Text>
          ) : (
            <>
              {recents.queries.length > 0 ? (
                <Section
                  title="Recent searches"
                  action={
                    <Pressable accessibilityRole="button" onPress={clear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text size="sm" tone="primary" weight="medium">
                        Clear
                      </Text>
                    </Pressable>
                  }>
                  <RowGroup inset={48}>
                    {recents.queries.map((q) => (
                      <Pressable
                        key={q}
                        accessibilityRole="button"
                        accessibilityLabel={`Search for ${q}`}
                        onPress={() => runRecent(q)}
                        style={({ pressed }) => [styles.recent, pressed ? { backgroundColor: t.colors.muted } : null]}>
                        <Icon name="clock" size={16} color={t.colors.mutedForeground} />
                        <Text size="base" numberOfLines={1} style={{ flex: 1 }}>
                          {q}
                        </Text>
                      </Pressable>
                    ))}
                  </RowGroup>
                </Section>
              ) : null}
              {recents.items.length > 0 ? (
                <Section title="Recently opened">
                  <RowGroup>{recents.items.map((item, i) => row(item, i))}</RowGroup>
                </Section>
              ) : null}
            </>
          )
        ) : groups.length > 0 ? (
          groups.map((group) => (
            <Section key={group.kind} title={group.title}>
              <RowGroup>{group.items.map((item, i) => row(item, i))}</RowGroup>
              {group.more > 0 ? (
                <Text size="xs" tone="muted" style={styles.more}>
                  {group.more} more. Add a word to narrow it down.
                </Text>
              ) : null}
            </Section>
          ))
        ) : search.isFetching || listsLoading ? (
          <RowSkeletons count={3} />
        ) : (
          <View style={styles.empty}>
            <Icon name="magnifyingglass" size={28} color={t.colors.mutedForeground} />
            <Text size="base" weight="medium">
              No results for “{debounced.trim()}”
            </Text>
            <Text size="sm" tone="muted" style={{ textAlign: 'center' }}>
              Try a name, hostname or domain.
            </Text>
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: 6, paddingTop: 8 },
  recent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  more: { paddingHorizontal: 6 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 48, paddingHorizontal: 24 },
});
