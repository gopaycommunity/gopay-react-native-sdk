/** The card charges, `awaitChargeState` with its events, and `errorCallback`. */

import { readFileSync } from 'fs';
import { join } from 'path';

type Listener = (event: never) => void;
const mockListeners = new Map<string, Set<Listener>>();

const mockNative = {
  version: '3.1.1',
  chargeReturnUrl: 'https://gopay.com/sdk/charge-return',
  initialize: jest.fn(),
  hasPaymentSession: jest.fn(),
  closeAllPaymentSessions: jest.fn(),
  sessionClose: jest.fn(),
  sessionChargeWithEncryptedCard: jest.fn(),
  sessionChargeWithCardToken: jest.fn(),
  sessionAwaitChargeState: jest.fn(),
  addListener: jest.fn((name: string, listener: Listener) => {
    const set = mockListeners.get(name) ?? new Set();
    set.add(listener);
    mockListeners.set(name, set);
    return { remove: () => set.delete(listener) };
  }),
};

jest.mock('expo', () => ({
  NativeModule: class {},
  requireNativeModule: () => mockNative,
  requireNativeView: () => 'NativePaymentCardForm',
}));

const { GopayError, GopaySDK } = require('../index') as typeof import('../index');
type PaymentSession = import('../index').PaymentSession;
type ChargePaymentResponse = import('../index').ChargePaymentResponse;

/** Sends a module event to the listeners JS has now, as native does. */
function emit(name: string, event: object): void {
  for (const listener of [...(mockListeners.get(name) ?? [])])
    (listener as (e: object) => void)(event);
}

const repoRoot = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

const SWIFT_MODULE = 'ios/GopayReactNativeSDKModule.swift';
const KOTLIN_MODULE = 'android/src/main/java/cz/gopay/reactnative/GopayReactNativeSDKModule.kt';

const listenerCount = (name: string) => mockListeners.get(name)?.size ?? 0;

/** Lets every pending promise callback run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A promise native answers with when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const charge = (state: ChargePaymentResponse['state'], extra: object = {}) =>
  ({ id: 'charge-1', state, ...extra }) as ChargePaymentResponse;

const actionRequired = charge('ACTION_REQUIRED', {
  action: { actionType: 'EMV3DS', redirectUrl: 'https://acs.example/challenge' },
});

/** The `callId` of the n-th `sessionAwaitChargeState` call. */
const callIdOf = (n = 0) => mockNative.sessionAwaitChargeState.mock.calls[n][1] as string;

async function openSession(paymentId = 'p1'): Promise<PaymentSession> {
  mockNative.hasPaymentSession.mockResolvedValueOnce({ result: true });
  return (await GopaySDK.getPaymentSession(paymentId))!;
}

let consoleError: jest.SpyInstance;

beforeEach(async () => {
  mockNative.closeAllPaymentSessions.mockResolvedValue({ result: null });
  await GopaySDK.closeAllPaymentSessions();
  jest.clearAllMocks();
  mockNative.initialize.mockReturnValue({ result: null });
  mockNative.sessionClose.mockResolvedValue({ result: null });
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  // Drops an errorCallback the test left, so that the next test starts without one; the tests
  // below check that an initialize without errorCallback removes its listener.
  mockNative.initialize.mockReturnValue({ result: null });
  GopaySDK.initialize({ environment: 'sandbox' });
  for (const [name, set] of mockListeners) {
    if (set.size) throw new Error(`${set.size} listener(s) of ${name} left`);
  }
});

describe('chargeWithEncryptedCard and chargeWithCardToken', () => {
  it.each([
    ['chargeWithEncryptedCard', 'sessionChargeWithEncryptedCard', 'header.key.iv.text.tag'],
    ['chargeWithCardToken', 'sessionChargeWithCardToken', 'card-token-1'],
  ] as const)(
    '%s passes its argument as it is and no preference without options',
    async (method, native, value) => {
      const succeeded = charge('REQUESTED');
      mockNative[native].mockResolvedValue({ result: succeeded });
      const session = await openSession();

      await expect(session[method](value)).resolves.toEqual(succeeded);

      expect(mockNative[native]).toHaveBeenCalledWith('p1', value, null);
    }
  );

  it.each([
    ['chargeWithEncryptedCard', 'sessionChargeWithEncryptedCard'],
    ['chargeWithCardToken', 'sessionChargeWithCardToken'],
  ] as const)('%s passes challengePreference as the API value', async (method, native) => {
    mockNative[native].mockResolvedValue({ result: charge('ACTION_REQUIRED') });
    const session = await openSession();

    await session[method]('value', { challengePreference: 'CHALLENGE_PREFERRED' });
    await session[method]('value', {});

    expect(mockNative[native].mock.calls).toEqual([
      ['p1', 'value', 'CHALLENGE_PREFERRED'],
      ['p1', 'value', null],
    ]);
  });

  it('throws the native error as a GopayError with chargeState and every other field', async () => {
    const declined = charge('FAILED', { failReason: 'DECLINED' });
    const gatewayError = { error: 'charge_exists', message: 'Charge exists' };
    mockNative.sessionChargeWithEncryptedCard.mockResolvedValue({
      error: {
        code: 'PAYMENT_013',
        message: 'exists',
        httpStatus: 409,
        chargeState: declined,
        gatewayError,
      },
    });
    const session = await openSession();

    const error = await session.chargeWithEncryptedCard('jwe').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GopayError);
    expect(error).toMatchObject({
      code: 'PAYMENT_013',
      message: 'exists',
      httpStatus: 409,
      chargeState: declined,
      gatewayError,
    });
  });

  it('answers AUTH_013 on a closed handle without asking native', async () => {
    const session = await openSession();
    await session.close();

    await expect(session.chargeWithCardToken('token')).rejects.toMatchObject({ code: 'AUTH_013' });
    await expect(session.chargeWithEncryptedCard('jwe')).rejects.toMatchObject({
      code: 'AUTH_013',
    });
    await expect(session.awaitChargeState()).rejects.toMatchObject({ code: 'AUTH_013' });
    expect(mockNative.sessionChargeWithCardToken).not.toHaveBeenCalled();
    expect(mockNative.sessionChargeWithEncryptedCard).not.toHaveBeenCalled();
    expect(mockNative.sessionAwaitChargeState).not.toHaveBeenCalled();
  });
});

describe('awaitChargeState', () => {
  it('without options passes none and listens to nothing', async () => {
    mockNative.sessionAwaitChargeState.mockResolvedValue({
      result: charge('SUCCEEDED'),
      events: 0,
    });
    const session = await openSession();

    await expect(session.awaitChargeState()).resolves.toEqual(charge('SUCCEEDED'));

    expect(mockNative.sessionAwaitChargeState).toHaveBeenCalledWith('p1', expect.any(String), {
      reportStateChanges: false,
      reportActionRequired: false,
    });
    expect(mockNative.addListener).not.toHaveBeenCalled();
  });

  it('passes the times in milliseconds, the mode and the return URL as they are', async () => {
    mockNative.sessionAwaitChargeState.mockResolvedValue({
      result: charge('SUCCEEDED'),
      events: 0,
    });
    const session = await openSession();

    await session.awaitChargeState({
      intervalMs: 250,
      initialTimeoutMs: 0,
      threeDSMode: 'manual',
      returnUrl: 'https://shop.example/return',
      onStateChange: () => {},
    });
    await session.awaitChargeState({ onActionRequired: () => {} });

    expect(mockNative.sessionAwaitChargeState.mock.calls.map((call) => call[2])).toEqual([
      {
        intervalMs: 250,
        initialTimeoutMs: 0,
        threeDSMode: 'manual',
        returnUrl: 'https://shop.example/return',
        reportStateChanges: true,
        reportActionRequired: false,
      },
      { reportStateChanges: false, reportActionRequired: true },
    ]);
  });

  it.each([null, false, 0, ''])(
    'takes %p for a callback as none, so that native sends no event nobody counts',
    async (none) => {
      // Native sends events only for the callbacks it is told about, as the bridges do.
      mockNative.sessionAwaitChargeState.mockImplementation(
        async (_id: string, callId: string, options: Record<string, unknown>) => {
          let events = 0;
          if (options.reportStateChanges) {
            emit('onChargeStateChange', { callId, charge: charge('SUCCEEDED') });
            events += 1;
          }
          if (options.reportActionRequired) {
            emit('onChargeActionRequired', { callId, redirectUrl: 'https://acs/1' });
            events += 1;
          }
          return { result: charge('SUCCEEDED'), events };
        }
      );
      const session = await openSession();
      const options = { onStateChange: none, onActionRequired: none } as unknown as Parameters<
        PaymentSession['awaitChargeState']
      >[0];
      let settled = false;

      const waiting = session.awaitChargeState(options).then((c) => {
        settled = true;
        return c;
      });
      await flush();

      expect(settled).toBe(true);
      await expect(waiting).resolves.toEqual(charge('SUCCEEDED'));
      expect(mockNative.sessionAwaitChargeState.mock.calls[0][2]).toEqual({
        reportStateChanges: false,
        reportActionRequired: false,
      });
      expect(mockNative.addListener).not.toHaveBeenCalled();
    }
  );

  it('passes an unknown threeDSMode on, and throws the VALIDATION_007 native answers', async () => {
    mockNative.sessionAwaitChargeState.mockResolvedValue({
      error: {
        code: 'VALIDATION_007',
        message: "awaitChargeState needs threeDSMode 'automatic' or 'manual'",
      },
      events: 0,
    });
    const session = await openSession();

    const error = await session
      .awaitChargeState({ threeDSMode: 'MANUAL' as never })
      .catch((e: unknown) => e);

    expect(mockNative.sessionAwaitChargeState.mock.calls[0][2]).toMatchObject({
      threeDSMode: 'MANUAL',
    });
    expect(error).toBeInstanceOf(GopayError);
    expect(error).toMatchObject({ code: 'VALIDATION_007' });
  });

  it('is refused by both bridges for a threeDSMode other than the two, with VALIDATION_007', () => {
    const swift = read(SWIFT_MODULE);
    const kotlin = read(KOTLIN_MODULE);

    expect(swift).toMatch(
      /case nil, "automatic": mode = \.automatic\s+case "manual": mode = \.manual\s+default:\s+throw GopaySDKError\(\s+\.validationInvalidInput/
    );
    expect(kotlin).toMatch(
      /null, "automatic" -> ThreeDSMode\.AUTOMATIC\s+"manual" -> ThreeDSMode\.MANUAL\s+else -> throw GopaySDKException\(\s+code = GopayErrorCodes\.VALIDATION_INVALID_INPUT/
    );
  });

  it('gives every call an id of its own', async () => {
    mockNative.sessionAwaitChargeState.mockResolvedValue({
      result: charge('SUCCEEDED'),
      events: 0,
    });
    const session = await openSession();

    await session.awaitChargeState();
    await session.awaitChargeState();

    expect(callIdOf(0)).not.toBe(callIdOf(1));
  });

  it('hands each of two calls on one payment only the events of its own id', async () => {
    const first = deferred<object>();
    const second = deferred<object>();
    mockNative.sessionAwaitChargeState
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const session = await openSession();
    const seen: string[] = [];

    const one = session.awaitChargeState({
      onStateChange: (c) => seen.push(`one ${c.state}`),
      onActionRequired: (url) => seen.push(`one ${url}`),
    });
    const two = session.awaitChargeState({
      onStateChange: (c) => seen.push(`two ${c.state}`),
      onActionRequired: (url) => seen.push(`two ${url}`),
    });
    await flush();

    emit('onChargeStateChange', { callId: callIdOf(1), charge: actionRequired });
    emit('onChargeActionRequired', { callId: callIdOf(1), redirectUrl: 'https://acs/2' });
    emit('onChargeStateChange', { callId: callIdOf(0), charge: charge('PROCESSING') });
    // An id of no call of this context, from a call of the context before a reload.
    emit('onChargeStateChange', { callId: 'old-1', charge: charge('FAILED') });
    emit('onChargeStateChange', { callId: callIdOf(0), charge: charge('SUCCEEDED') });
    first.resolve({ result: charge('SUCCEEDED'), events: 2 });
    await expect(one).resolves.toEqual(charge('SUCCEEDED'));
    emit('onChargeStateChange', { callId: callIdOf(1), charge: charge('SUCCEEDED') });
    second.resolve({ result: charge('SUCCEEDED'), events: 3 });
    await expect(two).resolves.toEqual(charge('SUCCEEDED'));

    expect(seen).toEqual([
      'two ACTION_REQUIRED',
      'two https://acs/2',
      'one PROCESSING',
      'one SUCCEEDED',
      'two SUCCEEDED',
    ]);
  });

  it('resolves only after the last onStateChange when the answer overtakes the events', async () => {
    mockNative.sessionAwaitChargeState.mockResolvedValue({
      result: charge('SUCCEEDED'),
      events: 3,
    });
    const session = await openSession();
    const order: string[] = [];

    const waiting = session
      .awaitChargeState({
        onStateChange: (c) => order.push(c.state),
        onActionRequired: (url) => order.push(url),
      })
      .then((c) => order.push(`resolved ${c.state}`));
    await flush();
    expect(order).toEqual([]);

    emit('onChargeStateChange', { callId: callIdOf(), charge: actionRequired });
    emit('onChargeActionRequired', { callId: callIdOf(), redirectUrl: 'https://acs/1' });
    await flush();
    expect(order).toEqual(['ACTION_REQUIRED', 'https://acs/1']);

    emit('onChargeStateChange', { callId: callIdOf(), charge: charge('SUCCEEDED') });
    await waiting;

    expect(order).toEqual(['ACTION_REQUIRED', 'https://acs/1', 'SUCCEEDED', 'resolved SUCCEEDED']);
  });

  it('rejects only after the last onStateChange, with the failed charge as chargeState', async () => {
    const failed = charge('FAILED', { failReason: 'DECLINED' });
    mockNative.sessionAwaitChargeState.mockResolvedValue({
      error: { code: 'PAYMENT_006', message: 'Charge failed: DECLINED', chargeState: failed },
      events: 1,
    });
    const session = await openSession();
    const order: string[] = [];

    const waiting = session
      .awaitChargeState({ onStateChange: (c) => order.push(c.state) })
      .catch((error: InstanceType<typeof GopayError>) => {
        order.push(`rejected ${error.code}`);
        return error;
      });
    await flush();
    emit('onChargeStateChange', { callId: callIdOf(), charge: failed });
    const error = await waiting;

    expect(order).toEqual(['FAILED', 'rejected PAYMENT_006']);
    expect(error).toBeInstanceOf(GopayError);
    expect(error).toMatchObject({ code: 'PAYMENT_006', chargeState: failed });
  });

  it('stops listening once it resolves, rejects or native fails', async () => {
    const session = await openSession();
    const callbacks = { onStateChange: () => {}, onActionRequired: () => {} };

    mockNative.sessionAwaitChargeState.mockResolvedValueOnce({
      result: charge('SUCCEEDED'),
      events: 0,
    });
    const resolving = session.awaitChargeState(callbacks);
    expect(listenerCount('onChargeStateChange')).toBe(1);
    expect(listenerCount('onChargeActionRequired')).toBe(1);
    await resolving;
    expect(listenerCount('onChargeStateChange')).toBe(0);
    expect(listenerCount('onChargeActionRequired')).toBe(0);

    mockNative.sessionAwaitChargeState.mockResolvedValueOnce({
      error: { code: 'PAYMENT_007', message: 'timeout' },
      events: 0,
    });
    await expect(session.awaitChargeState(callbacks)).rejects.toMatchObject({
      code: 'PAYMENT_007',
    });
    expect(listenerCount('onChargeStateChange')).toBe(0);

    // Not an SDK error: Expo rejects, and no event count comes.
    mockNative.sessionAwaitChargeState.mockRejectedValueOnce(new Error('bridge'));
    await expect(session.awaitChargeState(callbacks)).rejects.toThrow('bridge');
    expect(listenerCount('onChargeStateChange')).toBe(0);
    expect(listenerCount('onChargeActionRequired')).toBe(0);
  });

  it('goes on when a callback throws, and logs what it threw', async () => {
    const thrown = new Error('integrator bug');
    mockNative.sessionAwaitChargeState.mockResolvedValue({
      result: charge('SUCCEEDED'),
      events: 3,
    });
    const session = await openSession();
    const states: string[] = [];

    const waiting = session.awaitChargeState({
      onStateChange: (c) => {
        states.push(c.state);
        throw thrown;
      },
      onActionRequired: () => {
        throw thrown;
      },
    });
    await flush();
    emit('onChargeStateChange', { callId: callIdOf(), charge: actionRequired });
    emit('onChargeActionRequired', { callId: callIdOf(), redirectUrl: 'https://acs/1' });
    emit('onChargeStateChange', { callId: callIdOf(), charge: charge('SUCCEEDED') });

    await expect(waiting).resolves.toEqual(charge('SUCCEEDED'));
    expect(states).toEqual(['ACTION_REQUIRED', 'SUCCEEDED']);
    expect(consoleError).toHaveBeenCalledTimes(3);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('onStateChange'), thrown);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('onActionRequired'), thrown);
  });
});

describe('errorCallback', () => {
  const nativeError = {
    code: 'PAYMENT_006',
    message: 'Charge failed',
    httpStatus: 402,
    chargeState: charge('FAILED'),
    gatewayError: { error: 'declined' },
  };

  /** The `errorCallbackId` of the n-th `initialize`, from the end. */
  const callbackIdOf = (fromEnd = 1) => {
    const calls = mockNative.initialize.mock.calls;
    return calls[calls.length - fromEnd][0].errorCallbackId as string | undefined;
  };

  it('gets each reported error as a GopayError with every field', () => {
    const errors: unknown[] = [];
    GopaySDK.initialize({ environment: 'sandbox', errorCallback: (e) => errors.push(e) });
    const callbackId = callbackIdOf();

    expect(callbackId).toEqual(expect.any(String));
    emit('onGopayError', { callbackId, error: nativeError });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(GopayError);
    expect(errors[0]).toMatchObject(nativeError);
  });

  it('is replaced by the next initialize, and gone after one without it', () => {
    const first = jest.fn();
    const second = jest.fn();
    GopaySDK.initialize({ environment: 'sandbox', errorCallback: first });
    const firstId = callbackIdOf();
    GopaySDK.initialize({ environment: 'sandbox', errorCallback: second });
    const secondId = callbackIdOf();

    expect(secondId).not.toBe(firstId);
    emit('onGopayError', { callbackId: firstId, error: nativeError });
    emit('onGopayError', { callbackId: secondId, error: nativeError });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    GopaySDK.initialize({ environment: 'sandbox' });
    expect(mockNative.initialize).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ errorCallbackId: expect.anything() })
    );
    expect(listenerCount('onGopayError')).toBe(0);
    emit('onGopayError', { callbackId: secondId, error: nativeError });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('without one, native gets no callback and JS listens to nothing', () => {
    GopaySDK.initialize({ environment: 'sandbox' });

    expect(callbackIdOf()).toBeUndefined();
    expect(mockNative.addListener).not.toHaveBeenCalled();
  });

  it('a failed initialize keeps the earlier callback, while its own hears why it failed', () => {
    const kept = jest.fn();
    const failing = jest.fn();
    GopaySDK.initialize({ environment: 'sandbox', errorCallback: kept });
    const keptId = callbackIdOf();
    mockNative.initialize.mockImplementationOnce((config: { errorCallbackId: string }) => {
      // Android reports the failure to the new config's callback while initialize runs.
      emit('onGopayError', {
        callbackId: config.errorCallbackId,
        error: { code: 'CONFIG_006', message: 'bad URL' },
      });
      return { error: { code: 'CONFIG_006', message: 'bad URL' } };
    });

    expect(() =>
      GopaySDK.initialize({ environment: { development: 'x' }, errorCallback: failing })
    ).toThrow(expect.objectContaining({ code: 'CONFIG_006' }));
    emit('onGopayError', { callbackId: keptId, error: nativeError });

    expect(failing).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFIG_006' }));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENT_006' }));
  });

  it('stops listening when initialize fails outside the envelope', () => {
    mockNative.initialize.mockImplementationOnce(() => {
      throw new Error('bridge');
    });

    expect(() => GopaySDK.initialize({ environment: 'sandbox', errorCallback: jest.fn() })).toThrow(
      'bridge'
    );
    expect(listenerCount('onGopayError')).toBe(0);
  });

  it('keeps the earlier callback when initialize fails outside the envelope', () => {
    const kept = jest.fn();
    GopaySDK.initialize({ environment: 'sandbox', errorCallback: kept });
    const keptId = callbackIdOf();
    mockNative.initialize.mockImplementationOnce(() => {
      throw new Error('bridge');
    });

    expect(() => GopaySDK.initialize({ environment: 'sandbox', errorCallback: jest.fn() })).toThrow(
      'bridge'
    );
    emit('onGopayError', { callbackId: keptId, error: nativeError });
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('logs what the callback throws', () => {
    const thrown = new Error('logger down');
    GopaySDK.initialize({
      environment: 'sandbox',
      errorCallback: () => {
        throw thrown;
      },
    });

    expect(() =>
      emit('onGopayError', { callbackId: callbackIdOf(), error: nativeError })
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('errorCallback'), thrown);
  });
});

describe('module events', () => {
  it('has the names JS listens to in Events(...) of both native modules', () => {
    const listened = new Set<string>();
    for (const file of ['src/callbacks.ts', 'src/GopaySDK.ts']) {
      for (const [, name] of read(file).matchAll(/addListener\('(\w+)'/g)) listened.add(name!);
    }
    const declared = (path: string) => {
      const events = /Events\(((?:\s*"\w+",?)+)\s*\)/.exec(read(path));
      return new Set([...(events?.[1] ?? '').matchAll(/"(\w+)"/g)].map(([, name]) => name));
    };

    expect([...listened].sort()).toEqual([
      'onChargeActionRequired',
      'onChargeStateChange',
      'onGopayError',
    ]);
    // The names each module sends, which no type checks: a typo there would leave a wait hanging.
    const sent = (path: string, call: RegExp) =>
      new Set([...read(path).matchAll(call)].map(([, name]) => name));

    expect(declared(SWIFT_MODULE)).toEqual(listened);
    expect(declared(KOTLIN_MODULE)).toEqual(listened);
    expect(sent(SWIFT_MODULE, /events\.send\("(\w+)"/g)).toEqual(listened);
    expect(sent(KOTLIN_MODULE, /sendEvent\("(\w+)"/g)).toEqual(listened);
  });
});

describe('the native awaitChargeState', () => {
  // The native SDKs answer a closed session before they judge the options, so the bridges look the
  // session up first: AUTH_013 then wins over the VALIDATION_007 of an unknown threeDSMode.
  it.each([
    [SWIFT_MODULE, 'private func awaitChargeState(', 'Self.session(paymentId)'],
    [KOTLIN_MODULE, 'AsyncFunction("sessionAwaitChargeState")', 'session(paymentId)'],
  ])('in %s looks the session up before it builds the options', (path, start, lookup) => {
    const source = read(path);
    const body = source.slice(source.indexOf(start));
    const sessionAt = body.indexOf(lookup);
    const optionsAt = body.indexOf('options.awaitChargeOptions(');

    expect(source).toContain(start);
    expect(sessionAt).toBeGreaterThan(-1);
    expect(optionsAt).toBeGreaterThan(sessionAt);
  });
});
