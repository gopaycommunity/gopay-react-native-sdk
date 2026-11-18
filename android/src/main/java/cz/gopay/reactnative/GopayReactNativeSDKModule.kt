package cz.gopay.reactnative

import cz.gopay.sdk.GopaySDK
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GopayReactNativeSDKModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GopayReactNativeSDK")

    // `GopaySDK.version` of the linked native SDK.
    Constant("version") {
      GopaySDK.version
    }
  }
}
