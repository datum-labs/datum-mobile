import { requireOptionalNativeModule } from 'expo';

export interface WidgetsInfo {
  /** The App Group container is reachable (built with IOS_WIDGETS=1 and an App Group). */
  available: boolean;
  appGroup?: string;
  /** The DatumWidgets extension is in this binary. */
  widgetsEmbedded?: boolean;
}

interface Subscription {
  remove(): void;
}

interface DatumWidgetsNative {
  getInfo(): WidgetsInfo;
  readSnapshot(): Promise<string | null>;
  writeSnapshot(json: string): Promise<void>;
  clearSnapshot(): Promise<void>;
  requestedProjects(): string[];
  consumePendingRoute(): string | null;
  reloadTimelines(): void;
  reloadControls(): void;
  addListener(event: 'onPendingRoute', listener: () => void): Subscription;
}

// Optional: dev clients and releases built before this module existed don't
// have it, and everything here must then be a no-op.
const native = requireOptionalNativeModule<DatumWidgetsNative>('DatumWidgets');

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** The Home Screen / Lock Screen widgets and Control Centre controls (`DatumWidgets` extension). */
export const DatumWidgets = {
  info(): WidgetsInfo {
    if (!native) return { available: false };
    return safe(() => native.getInfo(), { available: false });
  },
  readSnapshot: (): Promise<string | null> => (native ? native.readSnapshot() : Promise.resolve(null)),
  /** Write the snapshot JSON to the App Group and reload every widget timeline. */
  writeSnapshot: (json: string): Promise<void> => (native ? native.writeSnapshot(json) : Promise.resolve()),
  clearSnapshot: (): Promise<void> => (native ? native.clearSnapshot() : Promise.resolve()),
  requestedProjects: (): string[] => (native ? safe(() => native.requestedProjects(), []) : []),
  consumePendingRoute: (): string | null => (native ? safe(() => native.consumePendingRoute(), null) : null),
  reloadTimelines: () => native && safe(() => native.reloadTimelines(), undefined),
  reloadControls: () => native && safe(() => native.reloadControls(), undefined),
  onPendingRoute(listener: () => void): Subscription {
    if (!native) return { remove() {} };
    return native.addListener('onPendingRoute', listener);
  },
};
