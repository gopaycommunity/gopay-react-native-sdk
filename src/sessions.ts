import { GopayError } from './GopayError';
import NativeGopay from './GopayReactNativeSDKModule';
import { awaitChargeState } from './callbacks';
import { type Envelope, unwrap } from './envelope';
import type {
  AwaitChargeOptions,
  ChargeOptions,
  ChargePaymentResponse,
  PaymentDetails,
  PaymentOutcome,
  QrCodeFormat,
  QrPaymentDetails,
} from './models';

/**
 * A payment-scoped session, `PaymentSession` of the native SDKs. In JS it is only a handle on the
 * session the native SDK keeps under `paymentId`; several handles may share one session. A call on
 * a closed handle, or on a session the native SDK no longer has, fails with `AUTH_013`.
 */
export interface PaymentSession {
  readonly paymentId: string;
  getStatus(): Promise<PaymentDetails>;
  getPaymentOutcome(): Promise<PaymentOutcome>;
  /**
   * Charges the payment with the JWE of a card, the one `GopaySDK.submitCardForm` returned. The
   * gateway takes each JWE once. Read the result with {@link PaymentSession.awaitChargeState}.
   */
  chargeWithEncryptedCard(jwe: string, options?: ChargeOptions): Promise<ChargePaymentResponse>;
  /**
   * Charges the payment with a permanent card token your backend got from the gateway. Read the
   * result with {@link PaymentSession.awaitChargeState}.
   */
  chargeWithCardToken(cardToken: string, options?: ChargeOptions): Promise<ChargePaymentResponse>;
  getChargeState(): Promise<ChargePaymentResponse>;
  /**
   * Polls the charge until it is decided, running a 3DS challenge on the way in `'automatic'`
   * mode, and resolves with the charge once it is `'SUCCEEDED'`. A `'FAILED'` charge rejects with
   * `PAYMENT_006`, one still undecided after `initialTimeoutMs` with `PAYMENT_007`, both with the
   * charge as `chargeState`. A 3DS challenge the user closes rejects with `PAYMENT_011`; a time that
   * is not positive, or a `threeDSMode` that is neither `'automatic'` nor `'manual'`, with
   * `VALIDATION_007` before anything is read. Every callback of `options` has run before the call
   * settles.
   */
  awaitChargeState(options?: AwaitChargeOptions): Promise<ChargePaymentResponse>;
  getQrPaymentInfo(format?: QrCodeFormat): Promise<QrPaymentDetails>;
  /**
   * Closes this handle for good. The native session, with its secret and token, closes with the
   * last open handle on it, so an effect's cleanup may always call it. Closing it again does nothing.
   */
  close(): Promise<void>;
}

// How JS counts the handles on a native session.
//
// JS keeps no native object, only per payment the handles it gave out on its native session (an
// entry) and the starts and gets that are still asking the native SDK (`pending`). The native
// session is closed when its last handle closes, so that the cleanup of one effect run (React
// Strict Mode runs effects twice) does not close the session another run holds.
//
// A start or get counts as pending from its first, synchronous step until it has its answer.
// While anything is pending for a payment, the close of its last handle is put off until the last
// pending call is done without a handle: a session the native SDK reports to that call is then
// never one JS is closing. A start or get that begins after such a close waits for it before it
// asks. `closeAllPaymentSessions` closes every session regardless; a start or get that overlaps it
// asks the native SDK again once it has run, since an answer from before it may be about a
// session it closed.
//
// After a reload all of this is gone and the native sessions stay; the next start or get finds
// them.

/** The handles on one native session. */
interface Entry {
  /** Open handles. Zero only while their close waits for the pending calls. */
  handles: number;
  /** False once the session is closed or known to be gone; its handles then answer `AUTH_013`. */
  alive: boolean;
}

/** What JS knows about one payment. */
interface Slot {
  /** The entry of its native session, or null when JS gave out no handle on one that is open. */
  entry: Entry | null;
  /** Starts and gets that are still asking the native SDK. */
  pending: number;
  /** Bumped with every handle given out, to tell whether one was given out while a call asked. */
  handedOut: number;
  /** The native close of its session while it runs; never rejects. */
  closing: Promise<void> | null;
}

const slots = new Map<string, Slot>();

/** Bumped by every `closeAllPaymentSessions`. */
let closeAllGeneration = 0;
/** Every native `closeAllPaymentSessions` still running, together; never rejects. */
let closingAll: Promise<void> | null = null;

/** What a handle knows besides its `paymentId`, kept outside the frozen handle. */
const handleState = new WeakMap<PaymentSessionHandle, { entry: Entry; closed: boolean }>();

const ignore = () => {};

function slotOf(paymentId: string): Slot {
  let slot = slots.get(paymentId);
  if (!slot) {
    slot = { entry: null, pending: 0, handedOut: 0, closing: null };
    slots.set(paymentId, slot);
  }
  return slot;
}

/** Drops a slot that holds nothing any more. */
function tidy(paymentId: string, slot: Slot): void {
  if (slot.pending === 0 && !slot.entry && !slot.closing && slots.get(paymentId) === slot) {
    slots.delete(paymentId);
  }
}

/** The error of a call on a closed handle, as the native SDKs throw it for a closed session. */
function sessionClosedError(paymentId: string): GopayError {
  return new GopayError('AUTH_013', `PaymentSession for ${paymentId} is closed`);
}

/** Retires the slot's entry: its handles answer `AUTH_013` from now on. */
function retire(slot: Slot): void {
  if (slot.entry) slot.entry.alive = false;
  slot.entry = null;
}

/** A new handle on the slot's native session, which exists. */
function handOut(paymentId: string, slot: Slot): PaymentSession {
  if (!slot.entry) slot.entry = { handles: 0, alive: true };
  slot.entry.handles += 1;
  slot.handedOut += 1;
  const handle = new PaymentSessionHandle(paymentId);
  handleState.set(handle, { entry: slot.entry, closed: false });
  return handle;
}

/**
 * Retires the slot's entry and closes its native session. Resolves with the native answer, which
 * only the handle whose close this is gets to see; a start or get waits on `slot.closing`, which
 * never rejects, so an error of the close is never theirs.
 */
function closeNative(paymentId: string, slot: Slot): Promise<Envelope<null>> {
  retire(slot);
  const close = NativeGopay.sessionClose(paymentId);
  const settled = close.then(ignore, ignore).then(() => {
    if (slot.closing === settled) {
      slot.closing = null;
      tidy(paymentId, slot);
    }
  });
  slot.closing = settled;
  return close;
}

/** Closes the native session when its last handle closed while calls were pending. */
function closeIfPutOff(paymentId: string, slot: Slot): void {
  if (slot.pending === 0 && slot.entry && slot.entry.handles === 0) {
    // Nobody waits for this close, so its answer goes nowhere.
    closeNative(paymentId, slot).catch(ignore);
  }
}

/**
 * A handle on the native session of `paymentId`. Asks the native SDK whether it has the session;
 * when it has not, `start` (if given) starts it, and without `start` the answer is null.
 */
export async function obtainSession(
  paymentId: string,
  start?: () => Promise<Envelope<string>>
): Promise<PaymentSession | null> {
  const slot = slotOf(paymentId);
  slot.pending += 1;
  let handle: PaymentSession | null = null;
  try {
    for (;;) {
      const generation = closeAllGeneration;
      const handedOut = slot.handedOut;
      await closingAll;
      await slot.closing;
      // Neither bridge answers `hasPaymentSession` with an SDK error (iOS looks in its registry,
      // Android checks `isInitialized` first). If it ever did, after a start of this call that
      // `closeAllPaymentSessions` overlapped, the session that start opened would stay open
      // without a handle until `closeAllPaymentSessions` or the next start and close of it.
      const exists = unwrap(await NativeGopay.hasPaymentSession(paymentId));
      // closeAllPaymentSessions began meanwhile: the answer may be about a session it closed.
      if (generation !== closeAllGeneration) continue;
      if (!exists) {
        // The session JS had handles on is gone, closed by an `initialize` with another
        // connection for one, unless another call has given out a handle meanwhile.
        if (slot.handedOut === handedOut) retire(slot);
        if (!start) return null;
        const envelope = await start();
        if (generation !== closeAllGeneration) {
          // closeAllPaymentSessions may have closed what this start opened: ask again. A start
          // that failed for any reason other than that fails as it is.
          if (!isAlreadyStarted(envelope)) unwrap(envelope);
          continue;
        }
        if (!isAlreadyStarted(envelope)) unwrap(envelope);
      }
      handle = handOut(paymentId, slot);
      return handle;
    }
  } finally {
    slot.pending -= 1;
    if (!handle) closeIfPutOff(paymentId, slot);
    tidy(paymentId, slot);
  }
}

/**
 * Closes every native session and retires every handle given out before. A start or get that runs
 * meanwhile asks the native SDK again once it has run.
 */
export async function closeAllSessions(): Promise<void> {
  closeAllGeneration += 1;
  for (const [paymentId, slot] of slots) {
    retire(slot);
    tidy(paymentId, slot);
  }
  const close = NativeGopay.closeAllPaymentSessions();
  // Chained onto the ones still running: a start that begins after this one has answered must
  // also wait for an earlier one, whose native effect could otherwise close its new session.
  const settled = Promise.all([closingAll, close.then(ignore, ignore)]).then(() => {
    if (closingAll === settled) closingAll = null;
  });
  closingAll = settled;
  unwrap(await close);
}

/** Whether a failed start only says that the payment has a session already. */
function isAlreadyStarted(envelope: Envelope<string>): boolean {
  return 'error' in envelope && envelope.error.code === 'AUTH_012';
}

class PaymentSessionHandle implements PaymentSession {
  constructor(readonly paymentId: string) {
    Object.freeze(this);
  }

  /** The `paymentId` to call native with, or `AUTH_013` for a handle that is closed. */
  private open(): string {
    const state = handleState.get(this);
    if (!state || state.closed || !state.entry.alive) throw sessionClosedError(this.paymentId);
    return this.paymentId;
  }

  async getStatus(): Promise<PaymentDetails> {
    return unwrap(await NativeGopay.sessionGetStatus(this.open()));
  }

  async getPaymentOutcome(): Promise<PaymentOutcome> {
    return unwrap(await NativeGopay.sessionGetPaymentOutcome(this.open()));
  }

  async chargeWithEncryptedCard(
    jwe: string,
    options?: ChargeOptions
  ): Promise<ChargePaymentResponse> {
    return unwrap(
      await NativeGopay.sessionChargeWithEncryptedCard(
        this.open(),
        jwe,
        options?.challengePreference ?? null
      )
    );
  }

  async chargeWithCardToken(
    cardToken: string,
    options?: ChargeOptions
  ): Promise<ChargePaymentResponse> {
    return unwrap(
      await NativeGopay.sessionChargeWithCardToken(
        this.open(),
        cardToken,
        options?.challengePreference ?? null
      )
    );
  }

  async getChargeState(): Promise<ChargePaymentResponse> {
    return unwrap(await NativeGopay.sessionGetChargeState(this.open()));
  }

  async awaitChargeState(options: AwaitChargeOptions = {}): Promise<ChargePaymentResponse> {
    return awaitChargeState(this.open(), options);
  }

  async getQrPaymentInfo(format?: QrCodeFormat): Promise<QrPaymentDetails> {
    return unwrap(await NativeGopay.sessionGetQrPaymentInfo(this.open(), format ?? null));
  }

  async close(): Promise<void> {
    const state = handleState.get(this);
    if (!state || state.closed) return;
    state.closed = true;
    const { entry } = state;
    if (!entry.alive) return;
    entry.handles -= 1;
    if (entry.handles > 0) return;
    const slot = slots.get(this.paymentId);
    if (!slot || slot.entry !== entry) return;
    // A start or get is asking the native SDK: the last of them closes the session if it ends
    // without a handle. That put-off close has nobody to report to, so if it fails, it fails
    // silently and the native session stays open.
    if (slot.pending > 0) return;
    unwrap(await closeNative(this.paymentId, slot));
  }
}
