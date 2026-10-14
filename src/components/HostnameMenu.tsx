import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { Button, Host, Menu } from '@expo/ui/swift-ui';
import { labelStyle, tint } from '@expo/ui/swift-ui/modifiers';

import { copyHostname, openHostname, shareHostname } from '@/lib/hostname-actions';

/** Native ⋯ menu: open, copy and share a hostname (copy only for wildcards). */
export function HostnameMenu({ hostname, openable }: { hostname: string; openable: boolean }) {
  const t = useDatumTheme();
  return (
    <Host matchContents colorScheme={t.scheme}>
      <Menu
        label={`Actions for ${hostname}`}
        systemImage="ellipsis.circle"
        modifiers={[labelStyle('iconOnly'), tint(t.colors.primary)]}>
        {openable ? (
          <Button label="Open in Browser" systemImage="safari" onPress={() => void openHostname(hostname)} />
        ) : null}
        <Button label="Copy Hostname" systemImage="doc.on.doc" onPress={() => void copyHostname(hostname)} />
        {openable ? (
          <Button label="Share…" systemImage="square.and.arrow.up" onPress={() => shareHostname(hostname)} />
        ) : null}
      </Menu>
    </Host>
  );
}
