import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { impactHaptic } from '@datum-cloud/datum-ui-native';

/** Native SwiftUI segmented control (UISegmentedControl look, Liquid Glass on iOS 26). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
      <Picker
        selection={value}
        onSelectionChange={(next) => {
          impactHaptic('light');
          onChange(next as T);
        }}
        modifiers={[pickerStyle('segmented')]}>
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
