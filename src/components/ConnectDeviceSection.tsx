import { Button, Card, CardContent, StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Host, Toggle } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { Alert, View } from 'react-native';

import { unavailableCopy } from '@/resources/connect/model';
import { useConnectThisDevice } from '@/resources/connect/queries';

import { InfoCard } from './InfoCard';
import { Notice } from './Notice';
import { Section } from './Section';

/**
 * "Connect this iPhone" on a Network: a native toggle that joins this device
 * to the network's VPC through Datum Connect (as `datumctl connect join`
 * does), its state, the assigned address and routes, and Disconnect.
 */
export function ConnectDeviceSection({
  project,
  network,
  displayName,
}: {
  project: string;
  network: string;
  displayName: string;
}) {
  const t = useDatumTheme();
  const device = useConnectThisDevice(project, network, displayName);
  const { view } = device;

  if (view.phase === 'unavailable') {
    const copy = unavailableCopy(device.availability);
    return (
      <Section title="Connect this iPhone">
        <Notice kind="info" icon="iphone.gen3.radiowaves.left.and.right" title={copy.title} description={copy.description} />
      </Section>
    );
  }

  const onToggle = (isOn: boolean) => {
    if (isOn === view.on || view.busy) return;
    if (isOn) {
      device.connect();
    } else {
      confirmDisconnect();
    }
  };

  const confirmDisconnect = () =>
    Alert.alert(
      `Disconnect from ${displayName}?`,
      'This iPhone leaves the network and its access to the VPC is removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => device.disconnect() },
      ]
    );

  const gated = device.errorCode === 'activation_approval_required';

  return (
    <Section title="Connect this iPhone">
      <Card size="sm">
        <CardContent style={{ gap: 10 }}>
          <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
            <Toggle
              isOn={view.on}
              label="Connect this iPhone"
              systemImage="iphone.gen3.radiowaves.left.and.right"
              onIsOnChange={onToggle}
              modifiers={[disabled(view.busy)]}
            />
          </Host>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <StatusBadge status={view.badge.status} label={view.badge.label} />
            {view.detail ? (
              <Text size="sm" tone="muted" mono={view.phase === 'connected'} numberOfLines={2} selectable style={{ flex: 1 }}>
                {view.detail}
              </Text>
            ) : null}
          </View>
          {view.otherNetwork && view.phase !== 'connected' ? (
            <Text size="xs" tone="muted">
              Connecting here disconnects {view.otherNetwork}. One network at a time.
            </Text>
          ) : null}
        </CardContent>
      </Card>

      {view.phase === 'connected' || (view.phase === 'connecting' && view.address) ? (
        <InfoCard
          rows={[
            { label: 'Address', value: view.address, mono: true },
            { label: 'Routes', value: view.routes.join('\n'), mono: true },
            { label: 'Location', value: view.location },
            { label: 'MTU', value: view.mtu },
          ]}
        />
      ) : null}

      {view.phase === 'connected' ? (
        <Button type="secondary" theme="outline" size="small" onPress={confirmDisconnect}>
          Disconnect
        </Button>
      ) : null}

      {view.error ? (
        <Notice
          kind={view.phase === 'connected' ? 'warning' : 'error'}
          title={view.phase === 'connected' ? 'Connected, with a problem' : "Couldn't connect"}
          description={view.error}
          action={
            gated ? (
              <Button type="secondary" theme="outline" size="small" onPress={() => device.connect({ requestGated: true })}>
                Request access
              </Button>
            ) : view.phase === 'error' ? (
              <Button type="secondary" theme="outline" size="small" onPress={() => device.connect()}>
                Try again
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {view.phase === 'disconnected' && !view.error ? (
        <Text size="xs" tone="muted" style={{ paddingHorizontal: 4, color: t.colors.mutedForeground }}>
          Routes only this network&apos;s private IPv6 prefix through Datum. Everything else stays on your normal
          connection.
        </Text>
      ) : null}
    </Section>
  );
}
