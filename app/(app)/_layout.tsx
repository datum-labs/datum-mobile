import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { unstable_getMaterialSymbolSourceAsync, type SFSymbol } from 'expo-symbols';
import { Platform } from 'react-native';

import { materialSymbolFor } from '@/lib/icons/material';

import { useConnectControlSync } from '@/resources/connect/queries';
import { useWidgetLinks, useWidgetSync } from '@/resources/widgets/hooks';

/**
 * Tab icon props: SF Symbols on iOS; on Android the Material Symbol rendered
 * to an image (the Material navigation bar tints it).
 */
function tabIcon(sf: SFSymbol | { default: SFSymbol; selected: SFSymbol }) {
  if (Platform.OS !== 'android') return { sf };
  const name = typeof sf === 'string' ? sf : sf.selected;
  return { src: unstable_getMaterialSymbolSourceAsync(materialSymbolFor(name), 24, '#000000') };
}

/**
 * System tab bar: UITabBar (Liquid Glass) on iOS 26, Material 3 navigation bar on Android. Each tab hosts its own native
 * stack so titles, pushes and the zoom transition stay per-tab.
 */
export default function AppTabs() {
  const t = useDatumTheme();
  // Home Screen widgets and Control Centre controls (README "Widgets and controls").
  useWidgetSync();
  useWidgetLinks(true);
  useConnectControlSync(true);
  const tint = t.scheme === 'dark' ? t.colors.primary : t.palette.midnightFjord;
  return (
    <NativeTabs
      tintColor={tint}
      minimizeBehavior="onScrollDown"
      labelStyle={{ fontFamily: t.fonts.sans.medium }}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...tabIcon({ default: 'house', selected: 'house.fill' })} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(edge)">
        <NativeTabs.Trigger.Label>Edge</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...tabIcon('globe.americas.fill')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(compute)">
        <NativeTabs.Trigger.Label>Compute</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...tabIcon('cpu')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(network)">
        <NativeTabs.Trigger.Label>Network</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...tabIcon('point.3.filled.connected.trianglepath.dotted')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...tabIcon({ default: 'person.crop.circle', selected: 'person.crop.circle.fill' })} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
