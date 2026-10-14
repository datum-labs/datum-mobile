import { impactHaptic, useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Host, SegmentedButton, SingleChoiceSegmentedButtonRow, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';

/** Material 3 segmented buttons (the Android counterpart of the SwiftUI segmented picker). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const t = useDatumTheme();
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
        {options.map((option) => (
          <SegmentedButton
            key={option.value}
            selected={option.value === value}
            onClick={() => {
              impactHaptic('light');
              onChange(option.value);
            }}
            colors={{
              activeContainerColor: t.colors.accent,
              activeContentColor: t.colors.foreground,
              inactiveContainerColor: 'transparent',
              inactiveContentColor: t.colors.mutedForeground,
              activeBorderColor: t.colors.border,
              inactiveBorderColor: t.colors.border,
            }}>
            <SegmentedButton.Label>
              <Text>{option.label}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
