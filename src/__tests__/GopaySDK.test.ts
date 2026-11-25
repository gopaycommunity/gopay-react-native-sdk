import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const mockNative = {
  version: '3.1.1',
  chargeReturnUrl: 'https://gopay.com/sdk/charge-return',
  initialize: jest.fn(),
  startPaymentSession: jest.fn(),
  hasPaymentSession: jest.fn(),
  closeAllPaymentSessions: jest.fn(),
  sessionGetStatus: jest.fn(),
  sessionGetPaymentOutcome: jest.fn(),
  sessionGetChargeState: jest.fn(),
  sessionGetQrPaymentInfo: jest.fn(),
  sessionClose: jest.fn(),
  submitCardForm: jest.fn(),
  submitCardFormWithMetadata: jest.fn(),
  clearCardFormData: jest.fn(),
};
const mockRequireNativeModule = jest.fn((_name: string) => mockNative);

jest.mock('expo', () => ({
  NativeModule: class {},
  requireNativeModule: (name: string) => mockRequireNativeModule(name),
  requireNativeView: () => 'NativePaymentCardForm',
}));

// Required, not imported: imports are hoisted above the mock factory's variables.
const { GopayError, GopaySDK } = require('../index') as typeof import('../index');
const { GOPAY_ERROR_CODES } = require('../GopayError') as typeof import('../GopayError');
const { NATIVE_MODULE_NAME } =
  require('../GopayReactNativeSDKModule') as typeof import('../GopayReactNativeSDKModule');
const { toNativeConfig } = require('../GopaySDK') as typeof import('../GopaySDK');
type GopayErrorInstance = import('../index').GopayError;
/** The module name JS asked for while loading, before beforeEach clears the mock. */
const requiredModuleNames = mockRequireNativeModule.mock.calls.map(([name]) => name);

const repoRoot = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

const charge = {
  id: 'charge-1',
  state: 'FAILED',
  paymentInstrument: {
    paymentInstrument: 'PAYMENT_CARD',
    details: { inputType: 'ENCRYPTED_CARD', maskedPan: '411111******1111', scheme: 'VISA' },
  },
  failReason: 'DECLINED',
} as const;

/** What the native module returns for a failure. */
const failure = (code: string, extra: object = {}) => ({
  error: { code, message: `[${code}] failed`, ...extra },
});

beforeEach(async () => {
  // Forgets the handle counts of the previous test.
  mockNative.closeAllPaymentSessions.mockResolvedValue({ result: null });
  await GopaySDK.closeAllPaymentSessions();
  jest.resetAllMocks();
  mockNative.initialize.mockReturnValue({ result: null });
  mockNative.hasPaymentSession.mockResolvedValue({ result: false });
  mockNative.sessionClose.mockResolvedValue({ result: null });
  mockNative.closeAllPaymentSessions.mockResolvedValue({ result: null });
});

describe('GopaySDK', () => {
  it('reads version and chargeReturnUrl from the native module that Swift and Kotlin register', () => {
    expect(GopaySDK.version).toBe('3.1.1');
    expect(GopaySDK.chargeReturnUrl).toBe('https://gopay.com/sdk/charge-return');
    expect(requiredModuleNames).toEqual([NATIVE_MODULE_NAME]);

    // A name that differs between JS and native only fails at runtime in the app, so check it here.
    const registered = `Name("${NATIVE_MODULE_NAME}")`;
    expect(read('ios/GopayReactNativeSDKModule.swift')).toContain(registered);
    expect(
      read('android/src/main/java/cz/gopay/reactnative/GopayReactNativeSDKModule.kt')
    ).toContain(registered);
  });

  it('keeps the version in package.json for both native builds', () => {
    expect(JSON.parse(read('package.json')).gopayNativeSdkVersion).toBe('3.1.1');
  });
});

describe('the envelope', () => {
  it('turns a result into the return value', async () => {
    const details = { id: 'p1', state: 'CREATED', amount: 100, currency: 'CZK' };
    mockNative.sessionGetStatus.mockResolvedValue({ result: details });

    await expect(new SessionOf('p1').getStatus()).resolves.toEqual(details);
  });

  it('turns an error into a GopayError with every field, the nested chargeState included', async () => {
    const gatewayError = { error: 'invalid_request', message: 'Declined', detail: 'by issuer' };
    mockNative.sessionGetChargeState.mockResolvedValue(
      failure('PAYMENT_006', { httpStatus: 402, chargeState: charge, gatewayError })
    );

    const error = await new SessionOf('p1').getChargeState().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GopayError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'GopayError',
      code: 'PAYMENT_006',
      message: '[PAYMENT_006] failed',
      httpStatus: 402,
      chargeState: charge,
      gatewayError,
    });
  });

  it('leaves out the fields the native error has not', async () => {
    mockNative.sessionGetStatus.mockResolvedValue(failure('AUTH_013'));

    const error = (await new SessionOf('p1')
      .getStatus()
      .catch((e: unknown) => e)) as GopayErrorInstance;

    expect(error.code).toBe('AUTH_013');
    expect('httpStatus' in error).toBe(false);
    expect('chargeState' in error).toBe(false);
    expect('gatewayError' in error).toBe(false);
  });

  it('throws from the synchronous initialize too', () => {
    mockNative.initialize.mockReturnValue(failure('CONFIG_006'));

    expect(() => GopaySDK.initialize({ environment: { development: 'ftp://x' } })).toThrow(
      expect.objectContaining({ code: 'CONFIG_006' })
    );
  });

  it('lets an unexpected rejection of the bridge through as it is, not as a GopayError', async () => {
    const bridgeError = Object.assign(new Error('boom'), { code: 'ERR_UNEXPECTED' });
    mockNative.sessionGetStatus.mockRejectedValue(bridgeError);

    const error = await new SessionOf('p1').getStatus().catch((e: unknown) => e);

    expect(error).toBe(bridgeError);
    expect(error).not.toBeInstanceOf(GopayError);
  });
});

describe('initialize', () => {
  it('passes sandbox and production as they are, with a 30 s timeout by default', () => {
    GopaySDK.initialize({ environment: 'sandbox', clientId: 'c', shareableKey: 'k' });
    GopaySDK.initialize({ environment: 'production' });

    expect(mockNative.initialize).toHaveBeenNthCalledWith(1, {
      environment: 'sandbox',
      clientId: 'c',
      shareableKey: 'k',
      debugLoggingEnabled: false,
      requestTimeoutMs: 30000,
    });
    expect(mockNative.initialize).toHaveBeenNthCalledWith(2, {
      environment: 'production',
      debugLoggingEnabled: false,
      requestTimeoutMs: 30000,
    });
  });

  it('flattens a development environment into its base URL', () => {
    GopaySDK.initialize({
      environment: { development: 'https://gw.example/api/' },
      debugLoggingEnabled: true,
      locale: 'cs',
      requestTimeoutMs: 60000,
    });

    expect(mockNative.initialize).toHaveBeenCalledWith({
      environment: 'development',
      baseUrl: 'https://gw.example/api/',
      debugLoggingEnabled: true,
      locale: 'cs',
      requestTimeoutMs: 60000,
    });
  });

  it.each([
    [undefined, 30000],
    [1500.4, 1500],
    [0, 30000],
    [-1, 30000],
    [Number.NaN, 30000],
    [Number.POSITIVE_INFINITY, 30000],
    [2 ** 31, 30000],
  ])('sends requestTimeoutMs %p as %p', (given, sent) => {
    expect(
      toNativeConfig({ environment: 'sandbox', requestTimeoutMs: given }).requestTimeoutMs
    ).toBe(sent);
  });

  it('refuses an environment it does not know without calling native', () => {
    expect(() => GopaySDK.initialize({ environment: 'staging' as never })).toThrow(TypeError);
    expect(mockNative.initialize).not.toHaveBeenCalled();
  });
});

describe('payment sessions', () => {
  it('starts a session and returns a handle on its paymentId', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });

    const session = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });

    expect(session.paymentId).toBe('p1');
    expect(mockNative.startPaymentSession).toHaveBeenCalledWith('p1', 's', null);
  });

  it('passes the scope when one is given', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });

    await GopaySDK.startPaymentSession({
      paymentId: 'p1',
      paymentSecret: 's',
      scope: 'payment:read',
    });

    expect(mockNative.startPaymentSession).toHaveBeenCalledWith('p1', 's', 'payment:read');
  });

  it('turns AUTH_012 into a handle on the session that exists', async () => {
    mockNative.startPaymentSession.mockResolvedValue(failure('AUTH_012'));

    const session = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's2' });

    expect(session.paymentId).toBe('p1');
  });

  it.each(['AUTH_010', 'AUTH_013', 'CONFIG_001', 'VALIDATION_007', 'NETWORK_004'])(
    'throws any other start error, %s, as it is',
    async (code) => {
      mockNative.startPaymentSession.mockResolvedValue(failure(code, { httpStatus: 401 }));

      await expect(
        GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' })
      ).rejects.toMatchObject({ code, httpStatus: 401 });
    }
  );

  it('getPaymentSession returns a new handle, or null', async () => {
    mockNative.hasPaymentSession.mockResolvedValueOnce({ result: true });
    mockNative.hasPaymentSession.mockResolvedValueOnce({ result: true });
    mockNative.hasPaymentSession.mockResolvedValueOnce({ result: false });

    const first = await GopaySDK.getPaymentSession('p1');
    const second = await GopaySDK.getPaymentSession('p1');

    expect(first?.paymentId).toBe('p1');
    expect(second).not.toBe(first);
    await expect(GopaySDK.getPaymentSession('p2')).resolves.toBeNull();
    expect(mockNative.hasPaymentSession).toHaveBeenLastCalledWith('p2');
  });

  it('getPaymentSession throws an error envelope as a GopayError', async () => {
    mockNative.hasPaymentSession.mockResolvedValue(failure('CONFIG_001'));

    await expect(GopaySDK.getPaymentSession('p1')).rejects.toBeInstanceOf(GopayError);
  });

  it('closeAllPaymentSessions resolves or throws', async () => {
    mockNative.closeAllPaymentSessions.mockResolvedValueOnce({ result: null });
    mockNative.closeAllPaymentSessions.mockResolvedValueOnce(failure('CONFIG_001'));

    await expect(GopaySDK.closeAllPaymentSessions()).resolves.toBeUndefined();
    await expect(GopaySDK.closeAllPaymentSessions()).rejects.toMatchObject({ code: 'CONFIG_001' });
  });

  it('every call of the handle goes to native with its paymentId', async () => {
    mockNative.hasPaymentSession.mockResolvedValue({ result: true });
    for (const fn of [
      mockNative.sessionGetStatus,
      mockNative.sessionGetPaymentOutcome,
      mockNative.sessionGetChargeState,
      mockNative.sessionGetQrPaymentInfo,
      mockNative.sessionClose,
    ]) {
      fn.mockResolvedValue({ result: null });
    }
    const session = (await GopaySDK.getPaymentSession('pay-42'))!;

    await session.getStatus();
    await session.getPaymentOutcome();
    await session.getChargeState();
    await session.getQrPaymentInfo();
    await session.getQrPaymentInfo('svg');
    await expect(session.close()).resolves.toBeUndefined();

    expect(mockNative.sessionGetStatus).toHaveBeenCalledWith('pay-42');
    expect(mockNative.sessionGetPaymentOutcome).toHaveBeenCalledWith('pay-42');
    expect(mockNative.sessionGetChargeState).toHaveBeenCalledWith('pay-42');
    expect(mockNative.sessionGetQrPaymentInfo).toHaveBeenNthCalledWith(1, 'pay-42', null);
    expect(mockNative.sessionGetQrPaymentInfo).toHaveBeenNthCalledWith(2, 'pay-42', 'svg');
    expect(mockNative.sessionClose).toHaveBeenCalledWith('pay-42');
  });

  it('the handle holds nothing but its paymentId', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });

    const session = await GopaySDK.startPaymentSession({
      paymentId: 'p1',
      paymentSecret: 'secret',
    });

    expect(Object.keys(session)).toEqual(['paymentId']);
    expect(JSON.stringify(session)).not.toContain('secret');
    expect(Object.isFrozen(session)).toBe(true);
  });
});

describe('starting a payment that has a session', () => {
  it('returns a handle without the native start, so the second secret goes nowhere', async () => {
    mockNative.hasPaymentSession.mockResolvedValue({ result: true });

    const session = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 'other' });

    expect(session.paymentId).toBe('p1');
    expect(mockNative.hasPaymentSession).toHaveBeenCalledWith('p1');
    expect(mockNative.startPaymentSession).not.toHaveBeenCalled();
  });

  it('still turns AUTH_012 into a handle when two starts race', async () => {
    let finishFirst: (value: unknown) => void = () => {};
    mockNative.startPaymentSession
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(failure('AUTH_012'));

    const first = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's1' });
    const second = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's2' });
    finishFirst({ result: 'p1' });

    expect(second.paymentId).toBe('p1');
    expect((await first).paymentId).toBe('p1');
    expect(mockNative.startPaymentSession).toHaveBeenCalledTimes(2);
  });
});

describe('handles on one session', () => {
  it('survive React Strict Mode: the first run closing its handle leaves the second one working', async () => {
    let finishFirst: (value: unknown) => void = () => {};
    mockNative.startPaymentSession.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve))
    );
    mockNative.sessionGetStatus.mockResolvedValue({ result: { id: 'p1' } });

    // Run 1 starts; while it waits, the native SDK has registered the session, and run 2 starts.
    const run1 = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await Promise.resolve();
    mockNative.hasPaymentSession.mockResolvedValue({ result: true });
    const handle2 = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    // Run 1 finishes, and its cleanup, which already ran, closes the handle it got.
    finishFirst({ result: 'p1' });
    await (await run1).close();

    expect(mockNative.sessionClose).not.toHaveBeenCalled();
    await expect(handle2.getStatus()).resolves.toEqual({ id: 'p1' });
    expect(mockNative.sessionGetStatus).toHaveBeenCalledWith('p1');

    await handle2.close();
    expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
    expect(mockNative.sessionClose).toHaveBeenCalledWith('p1');
  });

  it('counts the handles of getPaymentSession too', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const started = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    mockNative.hasPaymentSession.mockResolvedValue({ result: true });
    const found = (await GopaySDK.getPaymentSession('p1'))!;

    await started.close();
    expect(mockNative.sessionClose).not.toHaveBeenCalled();
    await found.close();
    expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
  });

  it('a closed handle answers AUTH_013 itself, for good, and closes only once', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const old = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await old.close();
    await old.close();
    expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);

    // A new session of the same payment does not revive it.
    await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    const error = await old.getStatus().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GopayError);
    expect(error).toMatchObject({ code: 'AUTH_013', message: 'PaymentSession for p1 is closed' });
    expect(mockNative.sessionGetStatus).not.toHaveBeenCalled();
  });

  it('closeAllPaymentSessions resets the counts and closes every handle', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const first = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    mockNative.hasPaymentSession.mockResolvedValue({ result: true });
    const second = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });

    await GopaySDK.closeAllPaymentSessions();
    await expect(first.getStatus()).rejects.toMatchObject({ code: 'AUTH_013' });
    await second.close();
    expect(mockNative.sessionClose).not.toHaveBeenCalled();

    // A new handle after it is the only one: its close closes the native session.
    const fresh = (await GopaySDK.getPaymentSession('p1'))!;
    await fresh.close();
    expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
  });

  it('a session the native SDK no longer has retires the old handles', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const old = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    // An initialize with another connection closed it natively; the next start sees no session.
    const fresh = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });

    await old.close();
    expect(mockNative.sessionClose).not.toHaveBeenCalled();
    await fresh.close();
    expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
  });

  it('a start waits for the native close of the last handle', async () => {
    let finishClose: (value: unknown) => void = () => {};
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    mockNative.sessionClose.mockImplementationOnce(
      () => new Promise((resolve) => (finishClose = resolve))
    );
    const old = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    const closed = old.close();
    const restart = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await Promise.resolve();

    expect(mockNative.hasPaymentSession).toHaveBeenCalledTimes(1);
    finishClose({ result: null });
    await closed;
    await restart;
    expect(mockNative.hasPaymentSession).toHaveBeenCalledTimes(2);
  });
});

describe('answers that arrive in any order', () => {
  /** Native calls that wait for the test to answer them, each in a step of its own. */
  type Call = {
    name: string;
    args: unknown[];
    resolve: (value: unknown) => void;
    reject: (e: unknown) => void;
  };
  let calls: Call[] = [];

  const defer = (...names: (keyof typeof mockNative)[]) => {
    for (const name of names) {
      (mockNative[name] as jest.Mock).mockImplementation(
        (...args: unknown[]) =>
          new Promise((resolve, reject) => calls.push({ name, args, resolve, reject }))
      );
    }
  };
  /** Lets every promise chain run until it waits for the native module again. */
  const step = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Answers the `nth` waiting call of `name` (the first by default), then lets JS run. */
  const answer = async (name: string, value: unknown, nth = 0) => {
    await step();
    const waiting = calls.filter((call) => call.name === name);
    const call = waiting[nth];
    if (!call) throw new Error(`no waiting ${name} call (${calls.map((c) => c.name).join(', ')})`);
    calls = calls.filter((c) => c !== call);
    call.resolve(value);
    await step();
  };

  beforeEach(() => {
    calls = [];
  });

  it.each(['before', 'after'])(
    'Strict Mode after a reload: run 1 closing %s run 2 hears back leaves run 2 the session',
    async (when) => {
      defer('hasPaymentSession');
      const run1 = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
      const run2 = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });

      await answer('hasPaymentSession', { result: true });
      const firstBack = when === 'before' ? await run1 : null;
      if (firstBack) await firstBack.close();
      await answer('hasPaymentSession', { result: true });
      const [handle1, handle2] = [await run1, await run2];
      if (!firstBack) await handle1.close();

      expect(mockNative.startPaymentSession).not.toHaveBeenCalled();
      expect(mockNative.sessionClose).not.toHaveBeenCalled();
      mockNative.sessionGetStatus.mockResolvedValue({ result: { id: 'p1' } });
      await expect(handle2.getStatus()).resolves.toEqual({ id: 'p1' });
      await handle2.close();
      expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['before', 'after'])(
    'a fresh payment: the first start finishing and closing %s the AUTH_012 of the second leaves the second working',
    async (when) => {
      defer('hasPaymentSession', 'startPaymentSession');
      const run1 = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
      const run2 = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
      await answer('hasPaymentSession', { result: false });
      await answer('hasPaymentSession', { result: false });

      if (when === 'before') {
        await answer('startPaymentSession', { result: 'p1' }, 0);
        await (await run1).close();
        await answer('startPaymentSession', failure('AUTH_012'), 0);
      } else {
        await answer('startPaymentSession', failure('AUTH_012'), 1);
        await answer('startPaymentSession', { result: 'p1' }, 0);
        await (await run1).close();
      }
      const handle2 = await run2;

      expect(mockNative.sessionClose).not.toHaveBeenCalled();
      mockNative.sessionGetStatus.mockResolvedValue({ result: { id: 'p1' } });
      await expect(handle2.getStatus()).resolves.toEqual({ id: 'p1' });
      await handle2.close();
      expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['before', 'after'])(
    'getPaymentSession while the last handle closes %s the answer: the session stays for the new handle',
    async (when) => {
      mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
      const last = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
      defer('hasPaymentSession');
      const got = GopaySDK.getPaymentSession('p1');

      if (when === 'before') {
        await step();
        await last.close();
        await answer('hasPaymentSession', { result: true });
      } else {
        await answer('hasPaymentSession', { result: true });
        await last.close();
      }
      const handle = (await got)!;

      expect(handle).not.toBeNull();
      expect(mockNative.sessionClose).not.toHaveBeenCalled();
      await handle.close();
      expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
    }
  );

  it('getPaymentSession that finds nothing leaves nothing to close', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const last = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    defer('hasPaymentSession');
    const got = GopaySDK.getPaymentSession('p1');
    await step();
    await last.close();
    expect(mockNative.sessionClose).not.toHaveBeenCalled();

    await answer('hasPaymentSession', { result: false });

    await expect(got).resolves.toBeNull();
    expect(mockNative.sessionClose).not.toHaveBeenCalled(); // the native SDK has none to close
  });

  it('getPaymentSession that fails closes the session whose close it put off', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const last = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    defer('hasPaymentSession');
    const got = GopaySDK.getPaymentSession('p1').catch((error: unknown) => error);
    await step();
    await last.close();
    expect(mockNative.sessionClose).not.toHaveBeenCalled();

    await answer('hasPaymentSession', failure('INTERNAL_001'));

    expect(await got).toMatchObject({ code: 'INTERNAL_001' });
    expect(mockNative.sessionClose).toHaveBeenCalledTimes(1);
    expect(mockNative.sessionClose).toHaveBeenCalledWith('p1');
  });

  it.each(['before', 'after'])(
    'a start overlapping closeAllPaymentSessions answered %s the start asks again',
    async (when) => {
      defer('hasPaymentSession', 'closeAllPaymentSessions');
      mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
      const run = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
      await step();
      const closeAll = GopaySDK.closeAllPaymentSessions();

      if (when === 'before') {
        await answer('hasPaymentSession', { result: true });
        await answer('closeAllPaymentSessions', { result: null });
      } else {
        await answer('closeAllPaymentSessions', { result: null });
        await answer('hasPaymentSession', { result: true });
      }
      await closeAll;
      await answer('hasPaymentSession', { result: false });
      const handle = await run;

      expect(mockNative.hasPaymentSession).toHaveBeenCalledTimes(2);
      expect(mockNative.startPaymentSession).toHaveBeenCalledTimes(1);
      mockNative.sessionGetStatus.mockResolvedValue({ result: { id: 'p1' } });
      await expect(handle.getStatus()).resolves.toEqual({ id: 'p1' });
    }
  );

  it('a start after the later of two overlapping closeAllPaymentSessions also waits for the earlier one', async () => {
    defer('closeAllPaymentSessions', 'hasPaymentSession');
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const earlier = GopaySDK.closeAllPaymentSessions();
    const later = GopaySDK.closeAllPaymentSessions();
    await answer('closeAllPaymentSessions', { result: null }, 1);
    await later;

    const run = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await step();
    expect(mockNative.hasPaymentSession).not.toHaveBeenCalled();

    await answer('closeAllPaymentSessions', { result: null });
    await earlier;
    await answer('hasPaymentSession', { result: false });
    await expect(run).resolves.toMatchObject({ paymentId: 'p1' });
  });

  it('a start waits for a running closeAllPaymentSessions before it asks', async () => {
    defer('closeAllPaymentSessions', 'hasPaymentSession');
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const closeAll = GopaySDK.closeAllPaymentSessions();
    const run = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await step();
    expect(mockNative.hasPaymentSession).not.toHaveBeenCalled();

    await answer('closeAllPaymentSessions', { result: null });
    await closeAll;
    await answer('hasPaymentSession', { result: false });
    await expect(run).resolves.toMatchObject({ paymentId: 'p1' });
  });

  it('a native start that closeAllPaymentSessions overlapped is checked again before its handle', async () => {
    defer('hasPaymentSession', 'startPaymentSession', 'closeAllPaymentSessions');
    const run = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await answer('hasPaymentSession', { result: false });
    const closeAll = GopaySDK.closeAllPaymentSessions();
    // The start opens the session, then closeAllPaymentSessions closes it natively.
    await answer('startPaymentSession', { result: 'p1' });
    await answer('closeAllPaymentSessions', { result: null });
    await closeAll;

    await answer('hasPaymentSession', { result: false });
    await answer('startPaymentSession', { result: 'p1' });
    await expect(run).resolves.toMatchObject({ paymentId: 'p1' });
    expect(mockNative.hasPaymentSession).toHaveBeenCalledTimes(2);
    expect(mockNative.startPaymentSession).toHaveBeenCalledTimes(2);
  });

  it('a late false does not retire the handle another start got meanwhile', async () => {
    defer('hasPaymentSession', 'startPaymentSession');
    const got = GopaySDK.getPaymentSession('p1');
    await step();
    const run = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await answer('hasPaymentSession', { result: false }, 1);
    await answer('startPaymentSession', { result: 'p1' });
    const handle = await run;
    // The get asked before the start opened the session; its false arrives only now.
    await answer('hasPaymentSession', { result: false });
    await expect(got).resolves.toBeNull();

    mockNative.sessionGetStatus.mockResolvedValue({ result: { id: 'p1' } });
    await expect(handle.getStatus()).resolves.toEqual({ id: 'p1' });
  });

  it('a failed native close is the error of that close only, not of a start waiting for it', async () => {
    mockNative.startPaymentSession.mockResolvedValue({ result: 'p1' });
    const last = await GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    defer('sessionClose');
    const closed = last.close();
    const restart = GopaySDK.startPaymentSession({ paymentId: 'p1', paymentSecret: 's' });
    await step();
    calls.find((call) => call.name === 'sessionClose')!.reject(new Error('bridge failed'));

    await expect(closed).rejects.toThrow('bridge failed');
    await expect(restart).resolves.toMatchObject({ paymentId: 'p1' });
  });
});

describe('card form calls', () => {
  // A JWE of five parts, as the gateway's look; the tests never need a real one.
  const jwe = 'header.key.iv.ciphertext.tag';
  // An id with spaces and capitals, so that a trim or a lowercase on the way would show.
  const formId = ' Checkout Form ';

  it('submitCardForm passes the formId as it is and resolves with the JWE', async () => {
    mockNative.submitCardForm.mockResolvedValue({ result: jwe });
    await expect(GopaySDK.submitCardForm(formId)).resolves.toBe(jwe);
    expect(mockNative.submitCardForm).toHaveBeenCalledWith(formId);
  });

  it.each(['VALIDATION_008', 'VALIDATION_007', 'CONFIG_001'])(
    'submitCardForm throws %s from the envelope as a GopayError',
    async (code) => {
      mockNative.submitCardForm.mockResolvedValue(failure(code));
      const error = await GopaySDK.submitCardForm(formId).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GopayError);
      expect(error).toMatchObject({ code, message: `[${code}] failed` });
    }
  );

  it('submitCardFormWithMetadata passes the formId and resolves with the payload and metadata', async () => {
    const result = {
      encryptedPayload: jwe,
      cardMetadata: {
        scheme: 'VISA',
        corporate: false,
        serviceType: 'DEBIT',
        issuerCountry: 'CZE',
      },
    };
    mockNative.submitCardFormWithMetadata.mockResolvedValue({ result });
    await expect(GopaySDK.submitCardFormWithMetadata(formId)).resolves.toEqual(result);
    expect(mockNative.submitCardFormWithMetadata).toHaveBeenCalledWith(formId);
  });

  it('submitCardFormWithMetadata resolves without cardMetadata when the native SDK has none', async () => {
    mockNative.submitCardFormWithMetadata.mockResolvedValue({ result: { encryptedPayload: jwe } });
    const payload = await GopaySDK.submitCardFormWithMetadata(formId);
    expect(payload).toEqual({ encryptedPayload: jwe });
    expect('cardMetadata' in payload).toBe(false);
  });

  it('submitCardFormWithMetadata throws the envelope error as a GopayError', async () => {
    mockNative.submitCardFormWithMetadata.mockResolvedValue(failure('VALIDATION_008'));
    const error = await GopaySDK.submitCardFormWithMetadata(formId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GopayError);
    expect(error).toMatchObject({ code: 'VALIDATION_008' });
  });

  it('clearCardFormData passes the formId to the native SDK at once and returns nothing', () => {
    // Whatever the native function returns, the call returns nothing.
    mockNative.clearCardFormData.mockReturnValue('native value');
    expect(GopaySDK.clearCardFormData(formId)).toBeUndefined();
    expect(mockNative.clearCardFormData).toHaveBeenCalledTimes(1);
    expect(mockNative.clearCardFormData).toHaveBeenCalledWith(formId);
  });
});

describe('GopayErrorCode', () => {
  // The shared contract lives in the native repositories, checked out next to this one locally.
  // CI has neither, so there the test is skipped, which Jest reports, rather than passed unchecked.
  const documents = [
    '../gp-gw-ios-sdk/sdk/docs/ERROR_CODES.md',
    '../gp-gw-android-sdk/sdk/docs/ERROR_CODES.md',
  ];
  for (const document of documents) {
    const path = join(repoRoot, document);
    const itWhenPresent = existsSync(path) ? it : it.skip;
    itWhenPresent(`matches ${document}`, () => {
      const documented = [...readFileSync(path, 'utf8').matchAll(/^### ([A-Z]+_\d{3})\b/gm)].map(
        (match) => match[1]
      );
      expect(documented.length).toBeGreaterThan(0);
      expect([...GOPAY_ERROR_CODES].sort()).toEqual([...documented].sort());
    });
  }
});

/** A handle as getPaymentSession makes it, for tests of a single call. */
class SessionOf {
  constructor(private readonly paymentId: string) {}
  private async handle() {
    mockNative.hasPaymentSession.mockResolvedValueOnce({ result: true });
    return (await GopaySDK.getPaymentSession(this.paymentId))!;
  }
  async getStatus() {
    return (await this.handle()).getStatus();
  }
  async getChargeState() {
    return (await this.handle()).getChargeState();
  }
}
