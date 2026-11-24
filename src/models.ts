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
