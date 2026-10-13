import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Form, Host, Picker, Section, Text, TextField, Toggle } from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  disabled,
  font,
  foregroundStyle,
  listRowBackground,
  onSubmit,
  scrollContentBackground,
  submitLabel,
  tag,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { describeError } from '@/api';
import { useProjectContext } from '@/context/ProjectContext';
import { connectService } from '@/resources/connect/service';
import { useCreateNetwork, useNetworks } from '@/resources/networks/queries';
import { networkNameFor } from '@/resources/networks/service';

type Families = 'ipv6' | 'dual';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/**
 * Form sheet: create a private network (auto IPAM) in the current project and,
 * where this build can run the tunnel, join this iPhone to it once it's Ready.
 */
export default function NewNetwork() {
  const t = useDatumTheme();
  const { selection } = useProjectContext();
  const projectId = selection?.projectId;
  const networks = useNetworks(projectId);
  const create = useCreateNetwork(projectId);
  const canConnect = useMemo(() => connectService.availability().available, []);

  const [displayName, setDisplayName] = useState('');
  const [families, setFamilies] = useState<Families>('ipv6');
  const [connect, setConnect] = useState(canConnect);

  const trimmed = displayName.trim();
  const name = networkNameFor(trimmed, (networks.data ?? []).map((n) => n.name));
  const ready = !!projectId && trimmed.length > 0 && !create.isPending;
  const row = listRowBackground(t.colors.card);

  const submit = () => {
    if (!ready) return;
    create.mutate(
      { name, displayName: trimmed, ipFamilies: families === 'dual' ? ['IPv6', 'IPv4'] : ['IPv6'] },
      {
        onSuccess: () => {
          router.back();
          router.push({
            pathname: '/networks/[id]',
            params: { id: name, ...(connect && canConnect ? { connect: '1' } : {}) },
          });
        },
        onError: (error) => Alert.alert("Couldn't create the network", describeError(error)),
      }
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New Network' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="checkmark"
          accessibilityLabel="Create network"
          variant="prominent"
          disabled={!ready}
          onPress={submit}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} colorScheme={t.scheme} useViewportSizeMeasurement>
        <Form modifiers={[scrollContentBackground('hidden')]}>
          <Section
            title="Name"
            footer={
              <Text modifiers={[SECONDARY]}>
                {trimmed ? `Resource name: ${name}` : `In ${selection?.projectName ?? 'this project'}.`}
              </Text>
            }>
            <TextField
              placeholder="e.g. Office VPC"
              autoFocus
              maxLength={63}
              onTextChange={setDisplayName}
              modifiers={[
                row,
                textInputAutocapitalization('words'),
                autocorrectionDisabled(),
                submitLabel('done'),
                onSubmit(submit),
                disabled(create.isPending),
              ]}
            />
          </Section>

          <Section
            title="Addressing"
            footer={
              <Text modifiers={[SECONDARY]}>
                Datum assigns a private IPv6 /48 automatically
                {families === 'dual' ? ', plus IPv4 from 10.128.0.0/9.' : '.'}
              </Text>
            }>
            <Picker
              label="IP families"
              selection={families}
              onSelectionChange={(value: Families) => setFamilies(value)}
              modifiers={[row, disabled(create.isPending)]}>
              <Text modifiers={[tag('ipv6')]}>IPv6</Text>
              <Text modifiers={[tag('dual')]}>IPv6 + IPv4</Text>
            </Picker>
          </Section>

          {canConnect ? (
            <Section
              footer={
                <Text modifiers={[SECONDARY]}>
                  Joins as soon as the network is ready. Only the network&apos;s private prefix goes through Datum.
                </Text>
              }>
              <Toggle
                isOn={connect}
                onIsOnChange={setConnect}
                label="Connect this iPhone"
                systemImage="iphone.gen3.radiowaves.left.and.right"
                modifiers={[row, disabled(create.isPending)]}
              />
            </Section>
          ) : null}

          {create.isPending ? (
            <Section>
              <Text modifiers={[row, SECONDARY, font({ size: 15 })]}>Creating {trimmed}…</Text>
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
