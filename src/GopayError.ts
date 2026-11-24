import type { ChargePaymentResponse } from './models';

/**
 * Every error code of the native SDKs, the shared contract of `sdk/docs/ERROR_CODES.md` in the iOS
 * and Android repositories. A test compares this list with those files. Never add a code here
 * alone: a new code is agreed into the contract of both native SDKs first.
 */
export const GOPAY_ERROR_CODES = [
  'AUTH_009',
  'AUTH_010',
  'AUTH_011',
  'AUTH_012',
  'AUTH_013',
  'NETWORK_001',
  'NETWORK_002',
  'NETWORK_003',
  'NETWORK_004',
  'NETWORK_005',
  'NETWORK_007',
  'CONFIG_001',
  'CONFIG_004',
  'CONFIG_006',
  'PAYMENT_003',
  'PAYMENT_004',
  'PAYMENT_006',
  'PAYMENT_007',
  'PAYMENT_008',
  'PAYMENT_009',
  'PAYMENT_010',
  'PAYMENT_011',
  'PAYMENT_012',
  'PAYMENT_013',
  'VALIDATION_007',
  'VALIDATION_008',
  'INTERNAL_001',
  'INTERNAL_003',
] as const;

export type GopayErrorCode = (typeof GOPAY_ERROR_CODES)[number];

/** The gateway's error body behind an HTTP error, each field optional. */
export interface GopayGatewayError {
  readonly error?: string;
  readonly message?: string;
  readonly detail?: string;
}

/**
 * An error of the native GoPay SDK: `GopaySDKError` on iOS, `GopaySDKException` on Android, with
 * the same code on both. Only errors of the SDK are `GopayError`; an unexpected failure of the
 * bridge itself rejects with a plain `Error` that is not one.
 */
// The optional fields are declared in this interface, merged into the class, rather than as class
// fields: a class field would be emitted by `tsc` (ESNext) as an own property set to `undefined`.
export interface GopayError {
  /** The HTTP status of the gateway's response, when the error comes from one. */
  readonly httpStatus?: number;
  /** The charge as it stood when the call failed, when the native error carries one. */
  readonly chargeState?: ChargePaymentResponse;
  /** The gateway's error body, when the error comes from an HTTP response that has one. */
  readonly gatewayError?: GopayGatewayError;
}

export class GopayError extends Error {
  /**
   * The shared error code, for example `'AUTH_013'`. The list is the one of the native SDK version
   * this package pins (`gopayNativeSdkVersion`), so the native SDK never sends a code outside it.
   */
  readonly code: GopayErrorCode;
  constructor(
    code: GopayErrorCode,
    message: string,
    details: {
      httpStatus?: number;
      chargeState?: ChargePaymentResponse;
      gatewayError?: GopayGatewayError;
    } = {}
  ) {
    super(message);
    this.name = 'GopayError';
    this.code = code;
    // Set only when present, so that a missing one is no own property (see the interface above).
    const self = this as { -readonly [K in keyof GopayError]: GopayError[K] };
    if (details.httpStatus !== undefined) self.httpStatus = details.httpStatus;
    if (details.chargeState !== undefined) self.chargeState = details.chargeState;
    if (details.gatewayError !== undefined) self.gatewayError = details.gatewayError;
    // Keeps `instanceof GopayError` working where `Error` subclasses are compiled to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
