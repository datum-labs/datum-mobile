import { requireOptionalNativeModule } from 'expo';

interface DatumDistributionNative {
  isTestFlight(): boolean;
}

// Optional: dev clients built before this module existed don't have it.
const native = requireOptionalNativeModule<DatumDistributionNative>('DatumDistribution');

let testFlight: boolean | undefined;

/** How this binary was distributed. */
export const DatumDistribution = {
  /** Installed from TestFlight (never true in the simulator or a development build). */
  get isTestFlight(): boolean {
    if (testFlight === undefined) {
      try {
        testFlight = native?.isTestFlight() ?? false;
      } catch {
        testFlight = false;
      }
    }
    return testFlight;
  },
};
