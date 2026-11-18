import ExpoModulesCore
import GopaySDK

public class GopayReactNativeSDKModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GopayReactNativeSDK")

    // `GopaySDK.version` of the linked native SDK.
    Constant("version") {
      GopaySDK.version
    }
  }
}
