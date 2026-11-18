import NativeGopay from './GopayReactNativeSDKModule';

/**
 * Entry point of the GoPay React Native SDK. Mirrors `GopaySDK` of the native iOS and Android SDKs.
 */
export const GopaySDK = Object.freeze({
  /** Version of the native GoPay SDK this package links (`GopaySDK.version` on iOS and Android). */
  get version(): string {
    return NativeGopay.version;
  },
});
