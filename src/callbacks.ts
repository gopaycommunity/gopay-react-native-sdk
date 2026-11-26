import NativeGopay, { type NativeAwaitChargeOptions } from './GopayReactNativeSDKModule';
import { unwrap } from './envelope';
import type { AwaitChargeOptions, ChargePaymentResponse } from './models';

// How the integrator's functions reach native, which cannot take a JS function: the ids that pair
// events with what they belong to, the call of an integrator's function, and `awaitChargeState`,
// the one call with callbacks. The registry of `errorCallback` is in `GopaySDK.ts`.
//
// Each callback is a module event. Each `awaitChargeState` call and each `errorCallback` gets an id
// of its own, which JS makes up and native sends back in every event, so that two calls (two
// `awaitChargeState` on one payment, say) never take each other's events. The ids start with a
// prefix drawn at random once per JS context, so that after a reload the new context does not
// take the events an old native call still sends.
//
// Expo does not order an event against the answer of a function. Native therefore answers
// `awaitChargeState` with the number of events it sent for the call, and JS settles the call only
// once that many have arrived: every callback has run before the call resolves or rejects.

const contextPrefix = Math.random().toString(36).slice(2, 10);
let lastId = 0;

/** An id no other call or callback of this JS context has; one of an earlier context differs in its prefix. */
export function nextCallbackId(): string {
  lastId += 1;
  return `${contextPrefix}-${lastId}`;
}

/**
 * Calls a function of the integrator. What it throws is logged with `console.error` and goes no
 * further: an event has nowhere to throw it to, and the call it belongs to goes on as native runs
 * it.
 */
export function invokeCallback<T>(name: string, callback: (value: T) => void, value: T): void {
  try {
    callback(value);
  } catch (error) {
    console.error(`GopaySDK: ${name} threw; the SDK goes on without it.`, error);
  }
}

/** `PaymentSession.awaitChargeState` on the native session of `paymentId`. */
export async function awaitChargeState(
  paymentId: string,
  options: AwaitChargeOptions
): Promise<ChargePaymentResponse> {
  const { intervalMs, initialTimeoutMs, threeDSMode, returnUrl, onStateChange, onActionRequired } =
    options;
  // One test for both the flag and the listener: native must send no event nobody counts, or the
  // call would wait for it for ever. Anything but a function (`null` from `cond ? fn : null`) is none.
  const stateListener = typeof onStateChange === 'function' ? onStateChange : undefined;
  const actionListener = typeof onActionRequired === 'function' ? onActionRequired : undefined;
  const native: NativeAwaitChargeOptions = {
    reportStateChanges: stateListener !== undefined,
    reportActionRequired: actionListener !== undefined,
  };
  // Left out, an option keeps the native default.
  if (intervalMs !== undefined) native.intervalMs = intervalMs;
  if (initialTimeoutMs !== undefined) native.initialTimeoutMs = initialTimeoutMs;
  if (threeDSMode !== undefined) native.threeDSMode = threeDSMode;
  if (returnUrl !== undefined) native.returnUrl = returnUrl;

  const callId = nextCallbackId();
  let received = 0;
  let expected = Infinity;
  let allReceived: (() => void) | undefined;
  const arrived = () => {
    received += 1;
    if (received >= expected) allReceived?.();
  };
  // Listening before the call, so that its first event finds the listener.
  const subscriptions = [
    stateListener &&
      NativeGopay.addListener('onChargeStateChange', (event) => {
        if (event.callId !== callId) return;
        invokeCallback('onStateChange', stateListener, event.charge);
        arrived();
      }),
    actionListener &&
      NativeGopay.addListener('onChargeActionRequired', (event) => {
        if (event.callId !== callId) return;
        invokeCallback('onActionRequired', actionListener, event.redirectUrl);
        arrived();
      }),
  ];
  try {
    const answer = await NativeGopay.sessionAwaitChargeState(paymentId, callId, native);
    if (received < answer.events) {
      await new Promise<void>((resolve) => {
        expected = answer.events;
        allReceived = resolve;
      });
    }
    return unwrap(answer);
  } finally {
    for (const subscription of subscriptions) subscription?.remove();
  }
}
