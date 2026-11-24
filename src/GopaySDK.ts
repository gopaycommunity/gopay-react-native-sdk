import NativeGopay, { type NativeConfig } from './GopayReactNativeSDKModule';
import { unwrap } from './envelope';
import { closeAllSessions, obtainSession, type PaymentSession } from './sessions';

export type { PaymentSession };

/** Where the SDK talks to: GoPay's production or sandbox gateway, or a gateway at `development`. */
export type GopayEnvironment = 'production' | 'sandbox' | { development: string };

/** Configuration of the SDK, `GopayConfig` of the native SDKs. */
export interface GopayConfig {
  environment: GopayEnvironment;
  clientId?: string;
  shareableKey?: string;
  /** Default `false`. */
  debugLoggingEnabled?: boolean;
  locale?: string;
  /**
   * Timeout of each request in milliseconds. Default 30000 on both platforms (the native default
   * is 60 s on iOS and 30 s on Android; the bridge always passes the value).
   */
  requestTimeoutMs?: number;
}

/** The request timeout when the config has none, or none the native SDKs accept. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** The longest timeout Android takes (`Int.MAX_VALUE` ms); a longer one it replaces with its own default. */
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

export interface StartPaymentSessionParams {
  paymentId: string;
  /** Goes to the native SDK only; never logged and never sent back to JS. */
  paymentSecret: string;
  /** OAuth scopes; the native default is `'payment:charge payment:read'`. */
  scope?: string;
}

/** The config as the native module takes it. Exported for tests. */
export function toNativeConfig(config: GopayConfig): NativeConfig {
  const { environment } = config;
  const native: NativeConfig = {
    environment: 'sandbox',
    debugLoggingEnabled: config.debugLoggingEnabled ?? false,
    requestTimeoutMs: requestTimeoutMs(config.requestTimeoutMs),
  };
  if (environment === 'production' || environment === 'sandbox') {
    native.environment = environment;
  } else if (
    typeof environment === 'object' &&
    environment !== null &&
    typeof environment.development === 'string'
  ) {
    native.environment = 'development';
    native.baseUrl = environment.development;
  } else {
    throw new TypeError(
      "GopayConfig.environment must be 'production', 'sandbox' or { development: baseUrl }"
    );
  }
  if (config.clientId !== undefined) native.clientId = config.clientId;
  if (config.shareableKey !== undefined) native.shareableKey = config.shareableKey;
  if (config.locale !== undefined) native.locale = config.locale;
  return native;
}

/**
 * A whole number of milliseconds both native SDKs take as it is. Anything else gets the default
 * here, as the native SDKs would do with their own, different defaults.
 */
function requestTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_REQUEST_TIMEOUT_MS;
  const rounded = Math.round(value);
  return rounded >= 1 && rounded <= MAX_REQUEST_TIMEOUT_MS ? rounded : DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * Entry point of the GoPay React Native SDK. Mirrors `GopaySDK` of the native iOS and Android SDKs.
 * Every failure of the SDK is thrown as a {@link GopayError}.
 */
export const GopaySDK = Object.freeze({
  /** Version of the native GoPay SDK this package links (`GopaySDK.version` on iOS and Android). */
  get version(): string {
    return NativeGopay.version;
  },

  /** `GopaySDK.chargeReturnUrl` of the native SDKs, the return address of a charge's 3DS. */
  get chargeReturnUrl(): string {
    return NativeGopay.chargeReturnUrl;
  },

  /**
   * Configures the SDK. Calling it again, as a reload does, is safe: with the same connection the
   * open sessions stay; with another one the native SDK closes them. On Android a development base
   * URL the HTTP client refuses throws `CONFIG_006` here; on iOS the first request fails with it.
   *
   * @throws {GopayError}
   */
  initialize(config: GopayConfig): void {
    unwrap(NativeGopay.initialize(toNativeConfig(config)));
  },

  /**
   * Starts the session for a payment and resolves once the native SDK has it.
   *
   * Unlike the native SDKs, a start for a payment that has a session already (after a reload, or
   * the second effect run of React Strict Mode) resolves with a handle on that session instead of
   * throwing `AUTH_012`. JS asks the native SDK first, so such a start sends nothing: its
   * `paymentSecret` goes nowhere. The secret reaches the gateway a second time in two cases only:
   * when two starts of the same payment run at once, the second one sends its secret before the
   * native SDK answers `AUTH_012`, and then resolves with a handle too, unless the gateway refuses
   * that secret; and when `closeAllPaymentSessions` overlaps a start, which may have closed the
   * session the start opened, the start asks again and starts natively once more with its secret.
   *
   * Each handle is closed on its own; the native session closes with the last one.
   *
   * @throws {GopayError}
   */
  async startPaymentSession(params: StartPaymentSessionParams): Promise<PaymentSession> {
    const { paymentId, paymentSecret, scope } = params;
    const session = await obtainSession(paymentId, () =>
      NativeGopay.startPaymentSession(paymentId, paymentSecret, scope ?? null)
    );
    // obtainSession with a start returns a handle or throws.
    return session!;
  },

  /**
   * A new handle on the session of `paymentId`, or `null` when the native SDK has none. The handle
   * counts as one of the session's handles: close it when done.
   *
   * @throws {GopayError}
   */
  async getPaymentSession(paymentId: string): Promise<PaymentSession | null> {
    return obtainSession(paymentId);
  },

  /**
   * Closes every open session; every handle given out before answers `AUTH_013`.
   *
   * @throws {GopayError}
   */
  async closeAllPaymentSessions(): Promise<void> {
    await closeAllSessions();
  },
});
