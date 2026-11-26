import { GopayError } from '@gopaycz/gopay-react-native-sdk';

// What the example shows of a thrown value and of a JWE, shared by the checkout, the card form and
// the card charge. The JWE is never shown, only its length and parts.

/** A thrown value: a GopayError with every field, anything else with its name and message. */
export function describeError(error: unknown): string {
  if (error instanceof GopayError) {
    const { code, message, httpStatus, chargeState, gatewayError } = error;
    return `GopayError ${JSON.stringify({ code, message, httpStatus, chargeState, gatewayError })}`;
  }
  return `${(error as Error)?.name ?? 'error'} ${(error as Error)?.message ?? String(error)}`;
}

/** A JWE by its length and parts only. */
export const describeJwe = (jwe: string) =>
  `JWE ${jwe.length} characters, ${jwe.split('.').length} parts`;
