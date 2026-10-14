import { Text, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Host, Switch } from '@expo/ui/jetpack-compose';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';

/** "Connect this phone": a Material 3 switch row. */
export function ConnectToggle({
  isOn,
  disabled,
  onChange,
}: {
  isOn: boolean;
  disabled: boolean;
  onChange: (isOn: boolean) => void;
}) {
  const t = useDatumTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn, disabled }}
      disabled={disabled}
      onPress={() => onChange(!isOn)}
      style={[styles.row, disabled ? { opacity: 0.5 } : null]}>
      <Icon name="iphone.gen3.radiowaves.left.and.right" size={20} color={t.colors.primary} />
      <Text size="base" weight="medium" style={{ flex: 1 }}>
        Connect this phone
      </Text>
      <View pointerEvents="none">
        <Host matchContents>
          <Switch
            value={isOn}
            enabled={!disabled}
            colors={{ checkedTrackColor: t.colors.primary, checkedThumbColor: t.colors.primaryForeground }}
          />
        </Host>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
});
