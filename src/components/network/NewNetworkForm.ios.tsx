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

import type { Families, NewNetworkState } from './useNewNetwork';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/**
 * The New Network sheet's form as a SwiftUI Form: name, IP families and, where
 * this build can run the tunnel, joining this iPhone once the network is Ready.
 */
export function NewNetworkForm({ form }: { form: NewNetworkState }) {
  const t = useDatumTheme();
  const { selection, create, canConnect, setDisplayName, families, setFamilies, connect, setConnect, trimmed, name, submit } =
    form;
  const row = listRowBackground(t.colors.card);

  return (
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
  );
}
