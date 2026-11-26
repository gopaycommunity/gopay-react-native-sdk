import { NativeModule, requireNativeModule } from 'expo';

import type { Envelope, NativeError } from './envelope';
import type {
  ChallengePreference,
  ChargePaymentResponse,
  EncryptedCardPayloadWithMetadata,
  PaymentDetails,
  PaymentOutcome,
  QrCodeFormat,
  QrPaymentDetails,
  ThreeDSMode,
} from './models';

/** Name of the native module; must match `Name(...)` in the Swift and Kotlin module definitions. */
export const NATIVE_MODULE_NAME = 'GopayReactNativeSDK';

/** `GopayConfig` as the bridge takes it: the environment flattened, the timeout always set. */
export interface NativeConfig {
  environment: 'production' | 'sandbox' | 'development';
  /** Only for `'development'`. */
  baseUrl?: string;
  clientId?: string;
  shareableKey?: string;
  debugLoggingEnabled: boolean;
  locale?: string;
  /** Milliseconds; iOS gets seconds from the bridge. */
  requestTimeoutMs: number;
  /**
   * Set when JS has an `errorCallback`: the native callback sends each error as `onGopayError`
   * with this id. Without it the native config has no callback.
   */
  errorCallbackId?: string;
}

/**
 * `AwaitChargeOptions` as the bridge takes it. A time left out keeps the native default; the
 * callbacks are events, sent only for the kinds JS asks for.
 */
export interface NativeAwaitChargeOptions {
  /** Milliseconds; iOS gets seconds from the bridge. */
  intervalMs?: number;
  /** Milliseconds; iOS gets seconds from the bridge. */
  initialTimeoutMs?: number;
  threeDSMode?: ThreeDSMode;
  returnUrl?: string;
  /** Whether to send `onChargeStateChange` for each state read. */
  reportStateChanges: boolean;
  /** Whether to send `onChargeActionRequired` for each new redirect URL. */
  reportActionRequired: boolean;
}

/**
 * What the native `sessionAwaitChargeState` resolves with: the envelope, and how many events it
 * sent for the call before it answered. JS waits for that many before it settles the call.
 */
export type AwaitChargeAnswer = Envelope<ChargePaymentResponse> & { events: number };

/** The module's events; internal, JS hands them to the functions the integrator passed. */
export type NativeEvents = {
  /** A charge state `awaitChargeState` read, for the call with `callId`. */
  onChargeStateChange(event: { callId: string; charge: ChargePaymentResponse }): void;
  /** A new 3DS redirect URL, for the `awaitChargeState` call with `callId`. */
  onChargeActionRequired(event: { callId: string; redirectUrl: string }): void;
  /** An error the native SDK reported to the `errorCallback` registered as `callbackId`. */
  onGopayError(event: { callbackId: string; error: NativeError }): void;
};

/**
 * The native module. Each function that can fail returns an {@link Envelope}; the session
 * functions take the `paymentId` of the session, which the native SDK looks up.
 */
declare class GopayReactNativeSDKModule extends NativeModule<NativeEvents> {
  /** `GopaySDK.version` of the linked native SDK. */
  readonly version: string;
  /** `GopaySDK.chargeReturnUrl` of the native SDK. */
  readonly chargeReturnUrl: string;

  initialize(config: NativeConfig): Envelope<null>;
  /** Resolves with the `paymentId` of the started session. */
  startPaymentSession(
    paymentId: string,
    paymentSecret: string,
    scope: string | null
  ): Promise<Envelope<string>>;
  /** Whether the native SDK has a session for `paymentId`. */
  hasPaymentSession(paymentId: string): Promise<Envelope<boolean>>;
  closeAllPaymentSessions(): Promise<Envelope<null>>;

  sessionGetStatus(paymentId: string): Promise<Envelope<PaymentDetails>>;
  sessionGetPaymentOutcome(paymentId: string): Promise<Envelope<PaymentOutcome>>;
  sessionGetChargeState(paymentId: string): Promise<Envelope<ChargePaymentResponse>>;
  sessionGetQrPaymentInfo(
    paymentId: string,
    format: QrCodeFormat | null
  ): Promise<Envelope<QrPaymentDetails>>;
  sessionClose(paymentId: string): Promise<Envelope<null>>;
  /** `challengePreference` null sends none. The JWE is never logged. */
  sessionChargeWithEncryptedCard(
    paymentId: string,
    jwe: string,
    challengePreference: ChallengePreference | null
  ): Promise<Envelope<ChargePaymentResponse>>;
  /** `challengePreference` null sends none. The token is never logged. */
  sessionChargeWithCardToken(
    paymentId: string,
    cardToken: string,
    challengePreference: ChallengePreference | null
  ): Promise<Envelope<ChargePaymentResponse>>;
  /** Sends the call's events with `callId`, which JS makes unique to the call. */
  sessionAwaitChargeState(
    paymentId: string,
    callId: string,
    options: NativeAwaitChargeOptions
  ): Promise<AwaitChargeAnswer>;

  /** Resolves with the JWE of the card the form under `formId` holds. */
  submitCardForm(formId: string): Promise<Envelope<string>>;
  submitCardFormWithMetadata(formId: string): Promise<Envelope<EncryptedCardPayloadWithMetadata>>;
  /** Never fails; does nothing before `initialize`. */
  clearCardFormData(formId: string): void;
}

export default requireNativeModule<GopayReactNativeSDKModule>(NATIVE_MODULE_NAME);
