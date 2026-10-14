import { Host, Toggle } from '@expo/ui/swift-ui';
import { disabled as disabledModifier } from '@expo/ui/swift-ui/modifiers';

/** "Connect this iPhone": a native SwiftUI toggle. */
export function ConnectToggle({
  isOn,
  disabled,
  onChange,
}: {
  isOn: boolean;
  disabled: boolean;
  onChange: (isOn: boolean) => void;
}) {
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
      <Toggle
        isOn={isOn}
        label="Connect this iPhone"
        systemImage="iphone.gen3.radiowaves.left.and.right"
        onIsOnChange={onChange}
        modifiers={[disabledModifier(disabled)]}
      />
    </Host>
  );
}
