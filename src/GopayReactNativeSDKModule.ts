import { NativeModule, requireNativeModule } from 'expo';

/** Name of the native module; must match `Name(...)` in the Swift and Kotlin module definitions. */
export const NATIVE_MODULE_NAME = 'GopayReactNativeSDK';

declare class GopayReactNativeSDKModule extends NativeModule {
  /** `GopaySDK.version` of the linked native SDK. */
  readonly version: string;
}

export default requireNativeModule<GopayReactNativeSDKModule>(NATIVE_MODULE_NAME);
