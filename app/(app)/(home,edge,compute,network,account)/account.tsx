import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import {
  Button,
  ConfirmationDialog,
  Form,
  HStack,
  Host,
  Image,
  LabeledContent,
  RNHostView,
  Section,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  disabled,
  font,
  foregroundStyle,
  listRowBackground,
  listSectionSpacing,
  scrollContentBackground,
  textSelection,
} from '@expo/ui/swift-ui/modifiers';
import { Image as RemoteImage } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert as NativeAlert } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { env } from '@/config/env';
import { useProjectContext } from '@/context/ProjectContext';
import { clearQueryCache } from '@/lib/query';
import { useUserProfile } from '@/resources/users/queries';

import { DatumDistribution } from '../../../modules/datum-distribution';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const host = (url: string) => url.replace(/^https:\/\//, '');

/**
 * Account, as a SwiftUI Form (the Settings-app inset grouped list) rendered
 * natively through @expo/ui, under the shared large Canela title. Rows use the
 * app's Alliance face at subheadline size, so they read like the rest of the
 * app and still follow Dynamic Type.
 */
export default function Account() {
  const t = useDatumTheme();
  const { state, signIn, signOut } = useAuth();
  const { selection } = useProjectContext();
  const [busy, setBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const user = state.status === 'signedIn' ? state.user : undefined;
  const devToken = state.status === 'signedIn' && state.devToken;
  const profile = useUserProfile(user?.sub).data;
  const name = profile?.fullName ?? user?.name;
  const email = profile?.email ?? user?.email;
  const row = listRowBackground(t.colors.card);
  const tint = t.scheme === 'dark' ? t.colors.primary : t.palette.midnightFjord;

  const text = (weight: 'regular' | 'medium' | 'semibold' = 'regular', textStyle: 'subheadline' | 'footnote' | 'headline' = 'subheadline') =>
    font({
      family: t.fonts.sans[weight],
      size: textStyle === 'headline' ? 17 : textStyle === 'footnote' ? 13 : 15,
      textStyle,
    });
  const MONO = font({ design: 'monospaced', size: 13, textStyle: 'footnote' });

  const switchAccount = async () => {
    setBusy(true);
    const result = await signIn({ selectAccount: true });
    setBusy(false);
    if (result.type === 'success') {
      await clearQueryCache();
      router.replace('/(home)/home');
    } else if (result.type === 'error') {
      NativeAlert.alert("Couldn't switch account", result.message);
    }
  };

  const doSignOut = async () => {
    setBusy(true);
    await clearQueryCache();
    await signOut();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      <Host
        style={{ flex: 1, backgroundColor: t.colors.background }}
        useViewportSizeMeasurement
        colorScheme={t.scheme}
        seedColor={tint}>
        <Form modifiers={[scrollContentBackground('hidden'), listSectionSpacing('compact'), text()]}>
          <Section
            footer={devToken ? <Text modifiers={[text('regular', 'footnote')]}>Signed in with a developer access token.</Text> : undefined}>
            <HStack spacing={12} modifiers={[row]}>
              {profile?.avatarUrl ? (
                <RNHostView matchContents>
                  <RemoteImage
                    source={{ uri: profile.avatarUrl }}
                    style={{ width: 44, height: 44, borderRadius: 22 }}
                    transition={200}
                    cachePolicy="disk"
                    accessibilityIgnoresInvertColors
                  />
                </RNHostView>
              ) : (
                <Image systemName="person.crop.circle.fill" size={44} modifiers={[SECONDARY]} />
              )}
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[text('semibold', 'headline')]}>{name ?? 'Signed in'}</Text>
                {email ? <Text modifiers={[text('regular', 'footnote'), SECONDARY]}>{email}</Text> : null}
              </VStack>
            </HStack>
          </Section>

          <Section title="Project">
            <LabeledContent label="Organization" modifiers={[row]}>
              <Text modifiers={[SECONDARY]}>{selection?.orgName ?? selection?.orgId ?? 'None'}</Text>
            </LabeledContent>
            <LabeledContent label="Project" modifiers={[row]}>
              <Text modifiers={[SECONDARY]}>{selection?.projectName ?? selection?.projectId ?? 'None'}</Text>
            </LabeledContent>
            <Button
              label="Change Project"
              systemImage="arrow.left.arrow.right"
              onPress={() => router.push('/context-switcher')}
              modifiers={[row]}
            />
          </Section>

          <Section>
            <Button
              label="Switch Account"
              systemImage="person.2"
              onPress={() => void switchAccount()}
              modifiers={[row, disabled(busy || devToken)]}
            />
            <ConfirmationDialog
              title="Sign out of Datum?"
              titleVisibility="visible"
              isPresented={confirmSignOut}
              onIsPresentedChange={setConfirmSignOut}>
              <ConfirmationDialog.Trigger>
                <Button
                  label="Sign Out"
                  systemImage="rectangle.portrait.and.arrow.right"
                  onPress={() => setConfirmSignOut(true)}
                  modifiers={[row, disabled(busy)]}
                />
              </ConfirmationDialog.Trigger>
              <ConfirmationDialog.Actions>
                <Button label="Sign Out" onPress={() => void doSignOut()} />
                <Button label="Cancel" role="cancel" />
              </ConfirmationDialog.Actions>
              <ConfirmationDialog.Message>
                <Text>You can sign back in at any time.</Text>
              </ConfirmationDialog.Message>
            </ConfirmationDialog>
          </Section>

          <Section title="About">
            <LabeledContent label="Version" modifiers={[row]}>
              <Text modifiers={[SECONDARY]}>{env.version}</Text>
            </LabeledContent>
            {env.variant !== 'production' ? (
              <LabeledContent label="Environment" modifiers={[row]}>
                <Text modifiers={[SECONDARY]}>{env.variant[0].toUpperCase() + env.variant.slice(1)}</Text>
              </LabeledContent>
            ) : null}
            {/* For testers reporting issues; App Store and development builds leave it out. */}
            {DatumDistribution.isTestFlight ? (
              <LabeledContent label="API" modifiers={[row]}>
                <Text modifiers={[SECONDARY, MONO, textSelection(true)]}>{host(env.apiUrl)}</Text>
              </LabeledContent>
            ) : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}
