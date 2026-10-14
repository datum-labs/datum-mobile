import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import {
  AlertDialog,
  Column,
  Host,
  HorizontalDivider,
  Icon,
  ListItem,
  RNHostView,
  Text,
  TextButton,
} from '@expo/ui/jetpack-compose';
import {
  alpha,
  clickable,
  combinedClickable,
  fillMaxSize,
  padding,
  verticalScroll,
} from '@expo/ui/jetpack-compose/modifiers';
import * as Clipboard from 'expo-clipboard';
import { Image as RemoteImage } from 'expo-image';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState, type ReactNode } from 'react';
import { ToastAndroid } from 'react-native';

import { env } from '@/config/env';
import { useMaterialSymbolSources } from '@/hooks/useMaterialSymbolSources';

import { DatumDistribution } from '../../../modules/datum-distribution';
import { apiHost, useAccountActions } from './useAccountActions';

const ICONS = ['arrow.left.arrow.right', 'person.2', 'rectangle.portrait.and.arrow.right'] as const;
const AVATAR = 56;
const TRANSPARENT = '#00000000';

/**
 * Account on Android: a Material 3 settings list in Jetpack Compose (via
 * @expo/ui). Profile header, then Project / Session / About groups of
 * `ListItem`s under primary-coloured section headers, with a Compose
 * `AlertDialog` to confirm signing out. Same data and actions as the iOS Form
 * (see useAccountActions).
 */
export function AccountScreen() {
  const t = useDatumTheme();
  const headerHeight = useHeaderHeight();
  const { selection, busy, devToken, profile, name, email, switchAccount, doSignOut } = useAccountActions();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const icons = useMaterialSymbolSources(ICONS);
  const avatarFallback = useMaterialSymbolSources(['person.crop.circle.fill'], AVATAR)['person.crop.circle.fill'];
  const tint = t.scheme === 'dark' ? t.colors.primary : t.palette.midnightFjord;
  const listColors = { containerColor: TRANSPARENT, supportingContentColor: t.colors.mutedForeground };

  const sans = (weight: 'regular' | 'medium' | 'semibold' = 'regular') => t.fonts.sans[weight];

  const header = (title: string) => (
    <Text
      color={tint}
      style={{ typography: 'titleSmall', fontFamily: sans('medium') }}
      modifiers={[padding(16, 24, 16, 8)]}>
      {title}
    </Text>
  );

  const headline = (label: string) => (
    <ListItem.HeadlineContent>
      <Text style={{ typography: 'bodyLarge', fontFamily: sans() }}>{label}</Text>
    </ListItem.HeadlineContent>
  );

  const supporting = (value: ReactNode, mono = false) => (
    <ListItem.SupportingContent>
      <Text style={{ typography: 'bodyMedium', fontFamily: mono ? 'monospace' : sans() }}>{value}</Text>
    </ListItem.SupportingContent>
  );

  const leadingIcon = (symbol: (typeof ICONS)[number]) =>
    icons[symbol] ? (
      <ListItem.LeadingContent>
        <Icon source={icons[symbol]} size={24} tint={tint} />
      </ListItem.LeadingContent>
    ) : null;

  /** A tappable row; disabled rows drop the click and fade like Material's disabled content. */
  const action = (enabled: boolean, onClick: () => void) => (enabled ? [clickable(onClick)] : [alpha(0.38)]);

  const copyApiHost = () => {
    void Clipboard.setStringAsync(apiHost(env.apiUrl)).then(() =>
      ToastAndroid.show('API host copied', ToastAndroid.SHORT)
    );
  };

  return (
    <Host style={{ flex: 1, backgroundColor: t.colors.background }} colorScheme={t.scheme} seedColor={tint}>
      <Column modifiers={[fillMaxSize(), verticalScroll(), padding(0, headerHeight, 0, 32)]}>
        <ListItem colors={listColors}>
          <ListItem.LeadingContent>
            {profile?.avatarUrl ? (
              <RNHostView matchContents>
                <RemoteImage
                  source={{ uri: profile.avatarUrl }}
                  style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }}
                  transition={200}
                  cachePolicy="disk"
                  accessibilityIgnoresInvertColors
                />
              </RNHostView>
            ) : avatarFallback ? (
              <Icon source={avatarFallback} size={AVATAR} tint={t.colors.mutedForeground} />
            ) : null}
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <Text style={{ typography: 'titleLarge', fontFamily: sans('semibold') }}>{name ?? 'Signed in'}</Text>
          </ListItem.HeadlineContent>
          {email ? supporting(email) : null}
        </ListItem>
        {devToken ? (
          <Text
            color={t.colors.mutedForeground}
            style={{ typography: 'bodySmall', fontFamily: sans() }}
            modifiers={[padding(16, 0, 16, 8)]}>
            Signed in with a developer access token.
          </Text>
        ) : null}

        <HorizontalDivider modifiers={[padding(0, 8, 0, 0)]} />
        {header('Project')}
        <ListItem colors={listColors}>
          {headline('Organization')}
          {supporting(selection?.orgName ?? selection?.orgId ?? 'None')}
        </ListItem>
        <ListItem colors={listColors}>
          {headline('Project')}
          {supporting(selection?.projectName ?? selection?.projectId ?? 'None')}
        </ListItem>
        <ListItem colors={listColors} modifiers={action(true, () => router.push('/context-switcher'))}>
          {leadingIcon('arrow.left.arrow.right')}
          {headline('Change project')}
        </ListItem>

        <HorizontalDivider modifiers={[padding(0, 8, 0, 0)]} />
        {header('Session')}
        <ListItem colors={listColors} modifiers={action(!(busy || devToken), () => void switchAccount())}>
          {leadingIcon('person.2')}
          {headline('Switch account')}
        </ListItem>
        <ListItem colors={listColors} modifiers={action(!busy, () => setConfirmSignOut(true))}>
          {leadingIcon('rectangle.portrait.and.arrow.right')}
          {headline('Sign out')}
        </ListItem>

        <HorizontalDivider modifiers={[padding(0, 8, 0, 0)]} />
        {header('About')}
        <ListItem colors={listColors}>
          {headline('Version')}
          {supporting(env.version)}
        </ListItem>
        {env.variant !== 'production' ? (
          <ListItem colors={listColors}>
            {headline('Environment')}
            {supporting(env.variant[0].toUpperCase() + env.variant.slice(1))}
          </ListItem>
        ) : null}
        {/* For testers reporting issues; Play Store and development builds leave it out. */}
        {DatumDistribution.isTestFlight ? (
          <ListItem colors={listColors} modifiers={[combinedClickable({ onLongClick: copyApiHost })]}>
            {headline('API')}
            {supporting(apiHost(env.apiUrl), true)}
          </ListItem>
        ) : null}
      </Column>

      {confirmSignOut ? (
        <AlertDialog onDismissRequest={() => setConfirmSignOut(false)}>
          <AlertDialog.Title>
            <Text style={{ fontFamily: sans('semibold') }}>Sign out of Datum?</Text>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <Text style={{ fontFamily: sans() }}>You can sign back in at any time.</Text>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <TextButton
              onClick={() => {
                setConfirmSignOut(false);
                void doSignOut();
              }}>
              <Text style={{ fontFamily: sans('medium') }}>Sign out</Text>
            </TextButton>
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <TextButton onClick={() => setConfirmSignOut(false)}>
              <Text style={{ fontFamily: sans('medium') }}>Cancel</Text>
            </TextButton>
          </AlertDialog.DismissButton>
        </AlertDialog>
      ) : null}
    </Host>
  );
}
