import { unstable_getMaterialSymbolSourceAsync, type SFSymbol } from 'expo-symbols';
import { useSyncExternalStore } from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';

import { materialSymbolFor } from './material';

/**
 * Header toolbar icons. iOS takes SF Symbol names; on Android, Stack.Toolbar
 * renders Compose icon buttons that need an image, so these Material Symbols
 * are rendered once while the splash screen shows and looked up by SF name.
 */
export const TOOLBAR_SYMBOLS = [
  'xmark',
  'checkmark',
  'plus',
  'arrow.left.arrow.right',
  'safari',
  'square.and.arrow.up',
  'terminal',
  'clock',
  'pause.fill',
  'play.fill',
  'clock.arrow.circlepath',
  'square.and.pencil',
  'bolt',
] as const satisfies readonly SFSymbol[];

export type ToolbarSymbol = (typeof TOOLBAR_SYMBOLS)[number];

const rendered = new Map<ToolbarSymbol, ImageSourcePropType>();
let loading: Promise<void> | undefined;

function preload(): Promise<void> {
  loading ??= Promise.all(
    TOOLBAR_SYMBOLS.map(async (symbol) => {
      // The Compose icon button tints it to the header colour.
      const source = await unstable_getMaterialSymbolSourceAsync(materialSymbolFor(symbol), 24, '#000000').catch(
        () => null
      );
      if (source) rendered.set(symbol, source);
    })
  ).then(() => undefined);
  return loading;
}

const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (Platform.OS === 'android') {
    void preload().then(() => {
      if (version === 0) {
        version = 1;
        for (const l of listeners) l();
      }
    });
  }
  return () => listeners.delete(listener);
}

function lookup(symbol: ToolbarSymbol): SFSymbol | ImageSourcePropType | undefined {
  if (Platform.OS !== 'android') return symbol;
  return rendered.get(symbol);
}

/**
 * `toolbarIcon(symbol)` for a Stack.Toolbar button or menu. Call it in the
 * component that renders the toolbar: on Android it redraws that component
 * once the Material images are ready (a few ms after launch).
 */
export function useToolbarIcon(): typeof lookup {
  useSyncExternalStore(subscribe, () => version, () => version);
  return lookup;
}

/** Start rendering the Android icons early (called at app start). */
export function preloadToolbarIcons(): void {
  if (Platform.OS === 'android') void preload();
}
