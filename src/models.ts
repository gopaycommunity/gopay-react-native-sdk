// Models the native SDKs return, with the property names of their iOS and Android types. Every
// enum is a string literal union with the gateway's values. `'UNKNOWN'` is in each one the gateway
// fills: the native SDKs map a value they do not know yet to it, and so must JS accept it.

export type Currency = 'CZK' | 'EUR' | 'PLN' | 'USD' | 'GBP' | 'HUF' | 'RON' | 'UNKNOWN';

export type PaymentState =
  | 'CREATED'
  | 'PAID'
  | 'CANCELED'
  | 'PAYMENT_METHOD_CHOSEN'
  | 'TIMEOUTED'
  | 'AUTHORIZED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'UNKNOWN';

export type ChargeState =
  'REQUESTED' | 'PROCESSING' | 'ACTION_REQUIRED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export type CardScheme = 'VISA' | 'MASTERCARD' | 'UNKNOWN';

export type ChargeActionType = 'EMV3DS' | 'UNKNOWN';

export type Emv3dsState =
  | 'CREATED'
  | 'CHALLENGE_REQUIRED'
  | 'AUTHENTICATED_CHALLENGE'
  | 'AUTHENTICATED_FRICTIONLESS'
  | 'NOT_AUTHENTICATED'
  | 'FAILED'
  | 'UNKNOWN';

export interface PaymentCustomer {
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly phoneNumber?: string;
  readonly city?: string;
  readonly street?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
  readonly customerId?: string;
}

export interface InstrumentDetails {
  readonly inputType: string;
  readonly maskedPan?: string;
  readonly expirationMonth?: string;
  readonly expirationYear?: string;
  readonly scheme?: CardScheme;
  readonly fingerprint?: string;
}

export interface PaymentInstrumentData {
  readonly paymentInstrument: string;
  readonly details?: InstrumentDetails;
}

export interface ChargeAction {
  readonly actionType: ChargeActionType;
  readonly state?: Emv3dsState;
  readonly redirectUrl?: string;
}

export interface ChargePaymentResponse {
  readonly id: string;
  readonly state: ChargeState;
  readonly paymentInstrument?: PaymentInstrumentData;
  readonly action?: ChargeAction;
  readonly failReason?: string;
}

/** The 3DS challenge preference a charge forwards to the gateway (`Payment-Card-Challenge-Preference`). */
export type ChallengePreference = 'AUTO' | 'CHALLENGE_PREFERRED' | 'NO_CHALLENGE_PREFERRED';

/** Options of a card charge. The browser data for 3DS is the device's; the native SDK fills it in. */
export interface ChargeOptions {
  /** Forwarded to the gateway as it is. Without it the charge sends none. */
  readonly challengePreference?: ChallengePreference;
}

/** Whether `awaitChargeState` runs a 3DS challenge itself (`'automatic'`) or leaves it to the app. */
export type ThreeDSMode = 'automatic' | 'manual';

/**
 * Options of `PaymentSession.awaitChargeState`, `AwaitChargeOptions` of the native SDKs. Every
 * option left out takes the native default.
 */
export interface AwaitChargeOptions {
  /** How long after one answer the next read goes out, in milliseconds. Default 1000. */
  readonly intervalMs?: number;
  /**
   * How long the charge may stay undecided before the call fails with `PAYMENT_007`, in
   * milliseconds from the call. Default 30000. Lifted while a 3DS challenge is open.
   */
  readonly initialTimeoutMs?: number;
  /**
   * Default `'automatic'`: the native SDK opens the 3DS challenge itself and polls on after it.
   * Any other value than these two rejects the call with `VALIDATION_007`.
   */
  readonly threeDSMode?: ThreeDSMode;
  /**
   * The `callback.return_url` the payment was created with, where the automatic 3DS challenge
   * ends. Without a usable one (missing, not `http(s)` or without a host) the native SDK waits for
   * `GopaySDK.chargeReturnUrl` instead.
   */
  readonly returnUrl?: string;
  /**
   * Called with every charge state the call reads, the last one included, before the call
   * resolves or rejects. An exception it throws is logged with `console.error` and does not end
   * the call.
   */
  readonly onStateChange?: (charge: ChargePaymentResponse) => void;
  /**
   * Called once for each new `action.redirectUrl` the charge reports, before the call settles. In
   * `'automatic'` mode the native SDK opens the challenge without waiting for it, so the challenge
   * may be on screen already when it runs; in `'manual'` mode the challenge is the app's to run.
   * An exception it throws is logged with `console.error` and does not end the call.
   */
  readonly onActionRequired?: (redirectUrl: string) => void;
}

/**
 * The payment as the gateway reports it. The native `paymentSecret` is left out on purpose: the
 * bridge never sends a secret back to JS.
 */
export interface PaymentDetails {
  readonly id: string;
  readonly orderNumber: string;
  readonly state: PaymentState;
  /** In the currency's minor units. */
  readonly amount: number;
  readonly currency: Currency;
  readonly gatewayUrl: string;
  readonly customer: PaymentCustomer;
  readonly charge?: ChargePaymentResponse;
}

/** `PaymentOutcome.Outcome` of the native SDKs. */
export type PaymentOutcomeValue = 'PAID' | 'DECLINED' | 'NOT_CHARGED' | 'UNDECIDED';

export interface PaymentOutcome {
  readonly outcome: PaymentOutcomeValue;
  readonly payment: PaymentDetails;
  /** `payment.charge`, as the native `PaymentOutcome.charge`. */
  readonly charge?: ChargePaymentResponse;
}

export type QrCodeFormat = 'png' | 'svg';

export interface QrLocalBankAccount {
  readonly prefix: string;
  readonly accountNumber: string;
  readonly bankCode: string;
  readonly variableSymbol: string;
}

export interface QrInternationalBankAccount {
  readonly bic?: string;
  readonly iban?: string;
  readonly reference?: string;
}

export interface QrRecipientBankAccount {
  readonly local?: QrLocalBankAccount;
  readonly international?: QrInternationalBankAccount;
}

export interface QrRecipientAddress {
  readonly street?: string;
  readonly city?: string;
  readonly zipCode?: string;
  readonly country?: string;
}

export interface QrRecipient {
  readonly name?: string;
  readonly bankAccount?: QrRecipientBankAccount;
  readonly address?: QrRecipientAddress;
}

export interface QrCodeList {
  readonly spayd?: string;
  readonly paybysquare?: string;
  readonly sepa?: string;
  readonly mnbQr?: string;
}

export interface QrPaymentDetails {
  /** In the currency's minor units. */
  readonly amount: number;
  readonly currency: Currency;
  readonly recipient: QrRecipient;
  readonly qrCode: QrCodeList;
}

/** `CardServiceType` of the native SDKs: whether a card is a debit or a credit card. */
export type CardServiceType = 'DEBIT' | 'CREDIT';

/**
 * What the gateway knows about a card from the start of its number (`POST /cards/bin-lookup`).
 * For showing the card or picking a flow; a payment never depends on it.
 */
export interface CardMetadata {
  /** `'VISA'` or `'MASTERCARD'`; the native SDKs never put `'UNKNOWN'` here. */
  readonly scheme: CardScheme;
  readonly corporate: boolean;
  /** The product level of the card, e.g. `GOLD`. */
  readonly brand?: string;
  readonly serviceType?: CardServiceType;
  /** The name of the bank that issued the card. */
  readonly issuer?: string;
  /** The issuer's country, ISO 3166-1 alpha-3, e.g. `CZE`. */
  readonly issuerCountry?: string;
}

/** What `GopaySDK.submitCardFormWithMetadata` resolves with. */
export interface EncryptedCardPayloadWithMetadata {
  /** The JWE of the card, good for a single charge within 10 minutes. Never log it. */
  readonly encryptedPayload: string;
  /**
   * Missing when the gateway knows nothing about the card, or the lookup failed or took longer
   * than 3 seconds. The payload is good either way.
   */
  readonly cardMetadata?: CardMetadata;
}
