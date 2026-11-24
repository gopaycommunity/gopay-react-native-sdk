import { GopayError, type GopayErrorCode, type GopayGatewayError } from './GopayError';
import type { ChargePaymentResponse } from './models';

/**
 * A native SDK error as the bridge sends it: every field of `GopaySDKError` (iOS) and
 * `GopaySDKException` (Android) that JS sees. A rejected Expo promise carries only a code and a
 * message, so errors cross the bridge as data and JS throws them.
 */
export interface NativeError {
  code: GopayErrorCode;
  message: string;
  httpStatus?: number;
  chargeState?: ChargePaymentResponse;
  gatewayError?: GopayGatewayError;
}

/** What every native function that can fail returns: its result, or the SDK error it ended with. */
export type Envelope<T> = { result: T } | { error: NativeError };

export function toGopayError(error: NativeError): GopayError {
  return new GopayError(error.code, error.message, {
    httpStatus: error.httpStatus,
    chargeState: error.chargeState,
    gatewayError: error.gatewayError,
  });
}

/** The result of `envelope`, or its error thrown as a `GopayError`. */
export function unwrap<T>(envelope: Envelope<T>): T {
  if ('error' in envelope) throw toGopayError(envelope.error);
  return envelope.result;
}
