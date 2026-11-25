import { NativeModule, requireNativeModule } from 'expo';

import type { Envelope } from './envelope';
import type {
  ChargePaymentResponse,
  EncryptedCardPayloadWithMetadata,
  PaymentDetails,
  PaymentOutcome,
  QrCodeFormat,
  QrPaymentDetails,
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
}

/**
 * The native module. Each function that can fail returns an {@link Envelope}; the session
 * functions take the `paymentId` of the session, which the native SDK looks up.
 */
declare class GopayReactNativeSDKModule extends NativeModule {
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

  /** Resolves with the JWE of the card the form under `formId` holds. */
  submitCardForm(formId: string): Promise<Envelope<string>>;
  submitCardFormWithMetadata(formId: string): Promise<Envelope<EncryptedCardPayloadWithMetadata>>;
  /** Never fails; does nothing before `initialize`. */
  clearCardFormData(formId: string): void;
}

export default requireNativeModule<GopayReactNativeSDKModule>(NATIVE_MODULE_NAME);
