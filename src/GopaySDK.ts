import type { EventSubscription } from 'expo';

import type { GopayError } from './GopayError';
import NativeGopay, { type NativeConfig, type NativeEvents } from './GopayReactNativeSDKModule';
import { invokeCallback, nextCallbackId } from './callbacks';
import { sanitizeCustomLocales, type GopayLocaleStrings } from './cardForm';
import { toGopayError, unwrap } from './envelope';
import type { EncryptedCardPayloadWithMetadata } from './models';
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
   * Your own translations of the card form, by locale code (`'cs'`, `'sk'`, …), each with all 12
   * keys of `GopayLocaleStrings`. They take precedence over the SDK's language of the same code
   * and are selected by `locale` here or on the form. The native SDKs keep only the language part
   * of a code (`'cs-CZ'` is `'cs'`). An entry with a key missing is left out, with a warning in
   * development. A later `initialize` adds its entries and replaces those of the same code, but
   * on neither platform removes the ones it leaves out: they stay until the app restarts.
   */
  customLocales?: Record<string, GopayLocaleStrings>;
  /**
   * Timeout of each request in milliseconds. Default 30000 on both platforms (the native default
   * is 60 s on iOS and 30 s on Android; the bridge always passes the value).
   */
  requestTimeoutMs?: number;
  /**
   * Called with each error the native SDK reports, once per error, for central logging. Not every
   * `GopayError` a call throws reaches it: the native SDKs leave out `PAYMENT_007` (an undecided
   * charge) and `PAYMENT_011` (a closed payment window), and the errors the bridge makes itself
   * never come here: `AUTH_013` of a closed handle or of a session the native SDK no longer has,
   * and `VALIDATION_007` of an unknown `threeDSMode`. It does not replace catching the error: the
   * call throws it all the same. It arrives as an event, so it may come shortly after the call
   * has thrown. An exception it throws is logged with `console.error`. Anything but a function
   * counts as no callback.
   */
  errorCallback?: (error: GopayError) => void;
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
  const customLocales = sanitizeCustomLocales(config.customLocales);
  if (customLocales !== undefined) native.customLocales = customLocales;
  return native;
}

/**
 * The `errorCallback`s native may still call, by the id it sends with each error: the one of the
 * last `initialize` that succeeded, and those of later ones that failed. A failed `initialize`
 * leaves the native config as it was, callback included, while the error it fails with goes to
 * its own callback, as in the native SDKs.
 */
const errorCallbacks = new Map<string, (error: GopayError) => void>();
let errorSubscription: EventSubscription | null = null;

const dispatchError: NativeEvents['onGopayError'] = ({ callbackId, error }) => {
  const callback = errorCallbacks.get(callbackId);
  if (callback) invokeCallback('errorCallback', callback, toGopayError(error));
};

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
    const native = toNativeConfig(config);
    const { errorCallback } = config;
    let callbackId: string | undefined;
    if (typeof errorCallback === 'function') {
      callbackId = nextCallbackId();
      native.errorCallbackId = callbackId;
      // Before the native call: Android reports a failed initialize while it runs.
      errorCallbacks.set(callbackId, errorCallback);
      errorSubscription ??= NativeGopay.addListener('onGopayError', dispatchError);
    }
    let envelope: ReturnType<typeof NativeGopay.initialize>;
    try {
      envelope = NativeGopay.initialize(native);
      if (!('error' in envelope)) {
        // The native SDK now calls this config's callback, or none.
        for (const id of [...errorCallbacks.keys()]) {
          if (id !== callbackId) errorCallbacks.delete(id);
        }
      }
    } catch (error) {
      // Not an SDK error: the native config is as it was, without this callback.
      if (callbackId) errorCallbacks.delete(callbackId);
      throw error;
    } finally {
      if (errorCallbacks.size === 0) {
        errorSubscription?.remove();
        errorSubscription = null;
      }
    }
    unwrap(envelope);
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

  /**
   * Encrypts the card the `PaymentCardForm` with `formId` holds into a JWE for the merchant's
   * backend. The card itself never reaches JS. On success the native SDK drops its copy of the
   * card and empties the form; a failure leaves the card as the user typed it.
   *
   * Use the JWE promptly and for a single charge: the gateway accepts it once and within 10
   * minutes of its creation. Never log it.
   *
   * @throws {GopayError} `VALIDATION_008` when no form is on screen under `formId` or its fields
   *   are empty, `VALIDATION_007` for an invalid card, `CONFIG_001` before
   *   `initialize`, and otherwise what the encryption ends with.
   */
  async submitCardForm(formId: string): Promise<string> {
    return unwrap(await NativeGopay.submitCardForm(formId));
  },

  /**
   * {@link GopaySDK.submitCardForm} that also returns what the gateway knows about the card. The
   * lookup never fails the call: without an answer within 3 seconds, `cardMetadata` is missing and
   * the JWE comes all the same. The call can therefore take up to 3 seconds longer.
   *
   * @throws {GopayError} What `submitCardForm` throws, for the same reasons.
   */
  async submitCardFormWithMetadata(formId: string): Promise<EncryptedCardPayloadWithMetadata> {
    return unwrap(await NativeGopay.submitCardFormWithMetadata(formId));
  },

  /**
   * Drops the native SDK's copy of the card in the form with `formId` and empties its fields, for
   * when the user abandons the checkout while the form stays on screen. Never throws.
   *
   * Before `initialize` the platforms differ, as the native SDKs do: iOS empties the form all the
   * same, while on Android, whose SDK clears only through its instance, nothing happens and the
   * form keeps what the user typed.
   */
  clearCardFormData(formId: string): void {
    NativeGopay.clearCardFormData(formId);
  },
});
