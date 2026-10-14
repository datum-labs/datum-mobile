import { useDatumTheme } from '@datum-cloud/datum-ui-native';
import { DropdownMenu, DropdownMenuItem, Host, Icon, IconButton, Text } from '@expo/ui/jetpack-compose';
import { useState } from 'react';

import { copyHostname, openHostname, shareHostname } from '@/lib/hostname-actions';
import { useMaterialSymbolSources } from '@/hooks/useMaterialSymbolSources';

/** Material 3 overflow menu: open, copy and share a hostname (copy only for wildcards). */
export function HostnameMenu({ hostname, openable }: { hostname: string; openable: boolean }) {
  const t = useDatumTheme();
  const [expanded, setExpanded] = useState(false);
  const more = useMaterialSymbolSources(['ellipsis.circle'])['ellipsis.circle'];
  const run = (action: () => void) => () => {
    setExpanded(false);
    action();
  };
  return (
    <Host matchContents>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)} color={t.colors.card}>
        <DropdownMenu.Trigger>
          <IconButton onClick={() => setExpanded(true)}>
            {more ? (
              <Icon source={more} tint={t.colors.primary} size={22} contentDescription={`Actions for ${hostname}`} />
            ) : (
              <Text>⋯</Text>
            )}
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {openable ? (
            <DropdownMenuItem onClick={run(() => void openHostname(hostname))}>
              <DropdownMenuItem.Text>
                <Text>Open in browser</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={run(() => void copyHostname(hostname))}>
            <DropdownMenuItem.Text>
              <Text>Copy hostname</Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
          {openable ? (
            <DropdownMenuItem onClick={run(() => shareHostname(hostname))}>
              <DropdownMenuItem.Text>
                <Text>Share</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
