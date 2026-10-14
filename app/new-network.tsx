import { router, Stack } from 'expo-router';

import { NewNetworkForm } from '@/components/network/NewNetworkForm';
import { useNewNetwork } from '@/components/network/useNewNetwork';
import { useToolbarIcon } from '@/lib/icons/toolbar';

/**
 * Form sheet: create a private network (auto IPAM) in the current project and,
 * where this build can run the tunnel, join this device to it once it's Ready.
 * The form is SwiftUI on iOS and Material 3 on Android (components/network).
 */
export default function NewNetwork() {
  const toolbarIcon = useToolbarIcon();
  const form = useNewNetwork();

  return (
    <>
      <Stack.Screen options={{ title: 'New Network' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon={toolbarIcon('xmark')} accessibilityLabel="Cancel" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={toolbarIcon('checkmark')}
          accessibilityLabel="Create network"
          variant="prominent"
          disabled={!form.ready}
          onPress={form.submit}
        />
      </Stack.Toolbar>
      <NewNetworkForm form={form} />
    </>
  );
}
