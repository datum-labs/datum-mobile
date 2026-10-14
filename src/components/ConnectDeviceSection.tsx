import { Button, Card, CardContent, StatusBadge, Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Host, Toggle } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useRef } from 'react';
import { Alert, Platform, View } from 'react-native';

import { unavailableCopy } from '@/resources/connect/model';
import { useConnectThisDevice } from '@/resources/connect/queries';

import { InfoCard } from './InfoCard';
import { Notice } from './Notice';
import { Section } from './Section';

/**
 * "Connect this iPhone" on a Network: a native toggle that joins this device
 * to the network's VPC through Datum Connect (as `datumctl connect join`
 * does), its state, the assigned address and routes, and Disconnect.
 *
 * `autoConnect` (a network just created in the app) joins as soon as the
 * network is Ready, i.e. has its IPv6 prefix, which the gateway routes.
 */
const SECTION_TITLE = Platform.OS === 'android' ? 'Connect this phone' : 'Connect this iPhone';

export function ConnectDeviceSection({
  project,
  network,
  displayName,
  networkReady = true,
  autoConnect = false,
  onAutoConnectStarted,
}: {
  project: string;
  network: string;
  displayName: string;
  networkReady?: boolean;
  autoConnect?: boolean;
  onAutoConnectStarted?: () => void;
}) {
  const t = useDatumTheme();
  const device = useConnectThisDevice(project, network, displayName);
  const { view } = device;

  const started = useRef(false);
  const waiting = autoConnect && !networkReady && view.phase === 'disconnected';
  useEffect(() => {
    if (!autoConnect || started.current || !networkReady || view.phase !== 'disconnected') return;
    started.current = true;
    device.connect();
    onAutoConnectStarted?.();
  }, [autoConnect, networkReady, view.phase, device, onAutoConnectStarted]);

  if (view.phase === 'unavailable') {
    const copy = unavailableCopy(device.availability);
    return (
      <Section title={SECTION_TITLE}>
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
    <Section title={SECTION_TITLE}>
      <Card size="sm">
        <CardContent style={{ gap: 10 }}>
          <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
            <Toggle
              isOn={view.on}
              label="Connect this iPhone"
              systemImage="iphone.gen3.radiowaves.left.and.right"
              onIsOnChange={onToggle}
              modifiers={[disabled(view.busy || waiting)]}
            />
          </Host>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <StatusBadge
              status={waiting ? 'pending' : view.badge.status}
              label={waiting ? 'Waiting' : view.badge.label}
            />
            {waiting ? (
              <Text size="sm" tone="muted" style={{ flex: 1 }}>
                Setting up the network. This iPhone joins as soon as it&apos;s ready.
              </Text>
            ) : view.detail ? (
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
      {view.phase === 'disconnected' && !view.error && !waiting ? (
        <Text size="xs" tone="muted" style={{ paddingHorizontal: 4, color: t.colors.mutedForeground }}>
          Routes only this network&apos;s private IPv6 prefix through Datum. Everything else stays on your normal
          connection.
        </Text>
      ) : null}
    </Section>
  );
}
