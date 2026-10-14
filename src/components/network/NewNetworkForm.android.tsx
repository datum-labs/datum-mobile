import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import {
  Button,
  CircularProgressIndicator,
  Column,
  Host,
  Icon,
  ListItem,
  OutlinedTextField,
  Row,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Switch,
  Text,
  TextButton,
} from '@expo/ui/jetpack-compose';
import {
  alpha,
  fillMaxSize,
  fillMaxWidth,
  padding,
  size,
  toggleable,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { router } from 'expo-router';

import { useMaterialSymbolSources } from '@/hooks/useMaterialSymbolSources';

import type { Families, NewNetworkState } from './useNewNetwork';

const ICONS = ['iphone.gen3.radiowaves.left.and.right'] as const;
const FAMILIES: readonly { value: Families; label: string }[] = [
  { value: 'ipv6', label: 'IPv6' },
  { value: 'dual', label: 'IPv6 + IPv4' },
];
const TRANSPARENT = '#00000000';

/**
 * The New Network sheet's form in Material 3 (Jetpack Compose via @expo/ui):
 * an outlined name field whose supporting text shows the derived resource
 * name, a segmented button row for IP families and, where this build can run
 * the tunnel, a switch to join this phone once the network is Ready.
 */
export function NewNetworkForm({ form }: { form: NewNetworkState }) {
  const t = useDatumTheme();
  const { selection, create, canConnect, setDisplayName, families, setFamilies, connect, setConnect, trimmed, name, submit, ready } =
    form;
  const icons = useMaterialSymbolSources(ICONS);
  const pending = create.isPending;
  const tint = t.scheme === 'dark' ? t.colors.primary : t.palette.midnightFjord;
  const sans = t.fonts.sans;

  const helper = (text: string) => (
    <Text color={t.colors.mutedForeground} style={{ typography: 'bodySmall', fontFamily: sans.regular }}>
      {text}
    </Text>
  );

  return (
    <Host style={{ flex: 1 }} colorScheme={t.scheme} seedColor={tint}>
      <Column
        verticalArrangement={{ spacedBy: 24 }}
        modifiers={[fillMaxSize(), verticalScroll(), padding(0, 8, 0, 32)]}>
        {/* Android bottom sheets have no navigation header, so the sheet carries its own. */}
        <Row
          verticalAlignment="center"
          horizontalArrangement={{ spacedBy: 8 }}
          modifiers={[fillMaxWidth(), padding(8, 0, 16, 0)]}>
          <TextButton onClick={() => router.back()} enabled={!pending}>
            <Text style={{ fontFamily: sans.medium }}>Cancel</Text>
          </TextButton>
          <Text style={{ typography: 'titleLarge', fontFamily: sans.semibold }} modifiers={[weight(1)]}>
            New network
          </Text>
          <Button onClick={() => submit()} enabled={ready}>
            <Text style={{ fontFamily: sans.medium }}>Create</Text>
          </Button>
        </Row>
        <OutlinedTextField
          autoFocus
          singleLine
          maxLength={63}
          enabled={!pending}
          onValueChange={setDisplayName}
          keyboardOptions={{ capitalization: 'words', autoCorrectEnabled: false, imeAction: 'done' }}
          keyboardActions={{ onDone: () => submit() }}
          textStyle={{ fontFamily: sans.regular }}
          modifiers={[fillMaxWidth(), padding(16, 0, 16, 0)]}>
          <OutlinedTextField.Label>
            <Text style={{ fontFamily: sans.regular }}>Name</Text>
          </OutlinedTextField.Label>
          <OutlinedTextField.Placeholder>
            <Text style={{ fontFamily: sans.regular }}>e.g. Office VPC</Text>
          </OutlinedTextField.Placeholder>
          <OutlinedTextField.SupportingText>
            <Text style={{ fontFamily: sans.regular }}>
              {trimmed ? `Resource name: ${name}` : `In ${selection?.projectName ?? 'this project'}.`}
            </Text>
          </OutlinedTextField.SupportingText>
        </OutlinedTextField>

        <Column verticalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth(), padding(16, 0, 16, 0)]}>
          <Text color={tint} style={{ typography: 'titleSmall', fontFamily: sans.medium }}>
            IP families
          </Text>
          <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
            {FAMILIES.map((option) => (
              <SegmentedButton
                key={option.value}
                selected={families === option.value}
                onClick={() => setFamilies(option.value)}
                enabled={!pending}>
                <SegmentedButton.Label>
                  <Text style={{ fontFamily: sans.medium }}>{option.label}</Text>
                </SegmentedButton.Label>
              </SegmentedButton>
            ))}
          </SingleChoiceSegmentedButtonRow>
          {helper(
            `Datum assigns a private IPv6 /48 automatically${families === 'dual' ? ', plus IPv4 from 10.128.0.0/9.' : '.'}`
          )}
        </Column>

        {canConnect ? (
          <ListItem
            colors={{ containerColor: TRANSPARENT, supportingContentColor: t.colors.mutedForeground }}
            modifiers={pending ? [alpha(0.38)] : [toggleable(connect, () => setConnect(!connect), { role: 'switch' })]}>
            {icons['iphone.gen3.radiowaves.left.and.right'] ? (
              <ListItem.LeadingContent>
                <Icon source={icons['iphone.gen3.radiowaves.left.and.right']} size={24} tint={tint} />
              </ListItem.LeadingContent>
            ) : null}
            <ListItem.HeadlineContent>
              <Text style={{ typography: 'bodyLarge', fontFamily: sans.regular }}>Connect this phone</Text>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <Text style={{ typography: 'bodyMedium', fontFamily: sans.regular }}>
                Joins as soon as the network is ready. Only the network&apos;s private prefix goes through Datum.
              </Text>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <Switch value={connect} onCheckedChange={setConnect} enabled={!pending} />
            </ListItem.TrailingContent>
          </ListItem>
        ) : null}

        {pending ? (
          <Row
            horizontalArrangement={{ spacedBy: 12 }}
            verticalAlignment="center"
            modifiers={[fillMaxWidth(), padding(16, 0, 16, 0)]}>
            <CircularProgressIndicator strokeWidth={2} modifiers={[size(20, 20)]} />
            <Text color={t.colors.mutedForeground} style={{ typography: 'bodyMedium', fontFamily: sans.regular }}>
              {`Creating ${trimmed}…`}
            </Text>
          </Row>
        ) : null}
      </Column>
    </Host>
  );
}
