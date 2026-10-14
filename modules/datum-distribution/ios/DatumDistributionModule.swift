import ExpoModulesCore
import Foundation

/// How this binary reached the device. TestFlight and App Store builds carry
/// no embedded provisioning profile (development and Ad Hoc builds do), and a
/// TestFlight install's App Store receipt is named `sandboxReceipt`. The
/// simulator also reports a sandbox receipt, so it's ruled out first.
public class DatumDistributionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DatumDistribution")

    Function("isTestFlight") { () -> Bool in
      #if targetEnvironment(simulator)
        return false
      #else
        if Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil { return false }
        return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
      #endif
    }
  }
}
