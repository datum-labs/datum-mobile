import { unstable_getMaterialSymbolSourceAsync } from 'expo-symbols';
import { useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import { materialSymbolFor } from '@/lib/icons/material';

const cache = new Map<string, Promise<ImageSourcePropType | null>>();

function load(symbol: string, size: number): Promise<ImageSourcePropType | null> {
  const key = `${symbol}@${size}`;
  let pending = cache.get(key);
  if (!pending) {
    // Rendered black: Compose `Icon` tints it with the surrounding content colour.
    pending = unstable_getMaterialSymbolSourceAsync(materialSymbolFor(symbol), size, '#000000').catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Android only: Material Symbol image sources for Compose `Icon`, looked up by
 * the SF Symbol name the app uses everywhere (see lib/icons/material). Entries
 * are missing until rendered, so callers should skip the icon until then.
 */
export function useMaterialSymbolSources<S extends string>(
  symbols: readonly S[],
  size = 24
): Partial<Record<S, ImageSourcePropType>> {
  const key = symbols.join('|');
  const [sources, setSources] = useState<Partial<Record<S, ImageSourcePropType>>>({});

  useEffect(() => {
    let live = true;
    const names = key.split('|').filter(Boolean) as S[];
    void Promise.all(names.map(async (name) => [name, await load(name, size)] as const)).then((entries) => {
      if (!live) return;
      const next: Partial<Record<S, ImageSourcePropType>> = {};
      for (const [name, source] of entries) if (source) next[name] = source;
      setSources(next);
    });
    return () => {
      live = false;
    };
  }, [key, size]);

  return sources;
}
