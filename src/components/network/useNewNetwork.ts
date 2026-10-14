import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { describeError } from '@/api';
import { useProjectContext } from '@/context/ProjectContext';
import { connectService } from '@/resources/connect/service';
import { useCreateNetwork, useNetworks } from '@/resources/networks/queries';
import { networkNameFor } from '@/resources/networks/service';

export type Families = 'ipv6' | 'dual';

/**
 * State and submit for the New Network sheet, shared by the route's toolbar
 * and the SwiftUI (iOS) and Material 3 (Android) forms: creates a private
 * network (auto IPAM) in the current project, then opens it, asking the
 * detail screen to join this device once it's Ready when the user chose to.
 */
export function useNewNetwork() {
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

  return {
    selection,
    create,
    canConnect,
    setDisplayName,
    families,
    setFamilies,
    connect,
    setConnect,
    trimmed,
    name,
    ready,
    submit,
  };
}

export type NewNetworkState = ReturnType<typeof useNewNetwork>;
