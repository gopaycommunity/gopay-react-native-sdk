/** `GopayConfig.customLocales` in `initialize`, beside the `errorCallback` it shares the config with. */
type Listener = (event: object) => void;
const mockListeners = new Map<string, Set<Listener>>();

const mockNative = {
  version: '3.1.1',
  chargeReturnUrl: 'https://gopay.com/sdk/charge-return',
  initialize: jest.fn(),
  closeAllPaymentSessions: jest.fn(),
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

// Required, not imported: imports are hoisted above the mock factory's variables.
const { GopayError, GopaySDK } = require('../index') as typeof import('../index');
const { resetWarningsForTests } = require('../cardForm') as typeof import('../cardForm');
type LocaleStrings = import('../index').GopayLocaleStrings;

const STRINGS: LocaleStrings = {
  panLabel: 'Číslo karty',
  panPlaceholder: '1234 1234 1234 1234',
  expLabel: 'Platnosť',
  expPlaceholder: 'MM/RR',
  cvvLabel: 'CVV',
  cvvPlaceholder: '123',
  pay: 'Zaplatiť',
  panErrorPattern: 'Neplatné číslo karty',
  expErrorPattern: 'Neplatná platnosť',
  cvvErrorPattern: 'Neplatné CVV',
  patternErrorMessage: 'Nesprávny formát',
  requiredErrorMessage: 'Povinné pole',
};

/** The config the n-th `initialize` sent, from the end. */
const sentConfig = (fromEnd = 1) => {
  const calls = mockNative.initialize.mock.calls;
  return calls[calls.length - fromEnd][0];
};

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  resetWarningsForTests();
  mockNative.initialize.mockReturnValue({ result: null });
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  // An initialize without errorCallback removes the listener a test left.
  GopaySDK.initialize({ environment: 'sandbox' });
  for (const [name, set] of mockListeners) {
    if (set.size) throw new Error(`${set.size} listener(s) of ${name} left`);
  }
});

describe('customLocales', () => {
  it('passes no customLocales when the config has none', () => {
    GopaySDK.initialize({ environment: 'sandbox' });
    expect(sentConfig()).not.toHaveProperty('customLocales');
  });

  it('passes each complete set under its code as it is', () => {
    const withNotice = { ...STRINGS, screenCaptureNotice: 'Skryté počas nahrávania' };
    GopaySDK.initialize({
      environment: 'sandbox',
      locale: 'sk',
      customLocales: { sk: STRINGS, 'cs-CZ': withNotice },
    });
    expect(sentConfig()).toMatchObject({
      locale: 'sk',
      customLocales: { sk: STRINGS, 'cs-CZ': withNotice },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves out an entry with a key missing, with a warning, and keeps the others', () => {
    const { requiredErrorMessage: _omitted, ...partial } = STRINGS;
    expect(() =>
      GopaySDK.initialize({
        environment: 'sandbox',
        customLocales: { sk: STRINGS, hu: partial as unknown as LocaleStrings },
      })
    ).not.toThrow();
    expect(sentConfig().customLocales).toEqual({ sk: STRINGS });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('GopayConfig.customLocales["hu"]');
    expect(warn.mock.calls[0]![0]).toContain('missing requiredErrorMessage');
  });

  it('leaves out an entry that is not an object, with a warning', () => {
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: { sk: 'slovensky' as unknown as LocaleStrings },
    });
    expect(sentConfig().customLocales).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('must be a plain object'));
  });

  it('registers none when customLocales is not an object, with a warning', () => {
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: [STRINGS] as unknown as Record<string, LocaleStrings>,
    });
    expect(sentConfig()).not.toHaveProperty('customLocales');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no custom locale is registered'));
  });

  it.each([
    ['a Map', new Map([['sk', STRINGS]]), 'Map'],
    ['a class instance', new (class Locales {})(), 'Locales'],
  ])('registers none when customLocales is %s, with a warning', (_name, locales, constructor) => {
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: locales as unknown as Record<string, LocaleStrings>,
    });
    expect(sentConfig()).not.toHaveProperty('customLocales');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`plain object of locale codes, got ${constructor}`)
    );
  });

  it('warns about two codes the native SDKs read as one language, and passes both', () => {
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: { cs: STRINGS, 'CS-cz': STRINGS, sk: STRINGS, 'sk_SK ': STRINGS },
    });
    expect(Object.keys(sentConfig().customLocales)).toEqual(['cs', 'CS-cz', 'sk', 'sk_SK ']);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toContain(
      '"cs" and "CS-cz", which a native SDK reads both as "cs"'
    );
    expect(warn.mock.calls[1]![0]).toContain('reads both as "sk"');
  });

  it('reads a code that starts with a separator as each native SDK does', () => {
    // Android reads '-cs' and '_sk' both as '', iOS '-cs' as 'cs', as the plain 'cs'.
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: { '-cs': STRINGS, _sk: STRINGS, cs: STRINGS },
    });
    expect(Object.keys(sentConfig().customLocales)).toEqual(['-cs', '_sk', 'cs']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"-cs" and "_sk", which a native SDK reads both as ""')
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"-cs" and "cs", which a native SDK reads both as "cs"')
    );
  });

  it('passes an entry with a screenCaptureNotice that is not a string without it, with a warning', () => {
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: { sk: { ...STRINGS, screenCaptureNotice: 5 } as unknown as LocaleStrings },
    });
    expect(sentConfig().customLocales).toEqual({ sk: STRINGS });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('customLocales["sk"].screenCaptureNotice must be a string')
    );
  });

  it('sends no customLocales with a later initialize that has none, as the native SDKs take it', () => {
    GopaySDK.initialize({ environment: 'sandbox', customLocales: { sk: STRINGS } });
    GopaySDK.initialize({ environment: 'sandbox' });
    expect(sentConfig(2).customLocales).toEqual({ sk: STRINGS });
    expect(sentConfig()).not.toHaveProperty('customLocales');
  });
});

describe('customLocales beside errorCallback', () => {
  it('keeps the errorCallback working with customLocales in the same config', () => {
    const errors: unknown[] = [];
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: { sk: STRINGS },
      errorCallback: (error) => errors.push(error),
    });
    expect(sentConfig().customLocales).toEqual({ sk: STRINGS });
    expect(sentConfig().errorCallbackId).toEqual(expect.any(String));

    const nativeError = { code: 'PAYMENT_006', message: 'Charge failed', httpStatus: 402 };
    for (const listener of mockListeners.get('onGopayError') ?? []) {
      listener({ callbackId: sentConfig().errorCallbackId, error: nativeError });
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(GopayError);
    expect(errors[0]).toMatchObject(nativeError);
  });

  it('keeps the errorCallback working when an entry of customLocales is left out', () => {
    const errorCallback = jest.fn();
    GopaySDK.initialize({
      environment: 'sandbox',
      customLocales: { sk: {} as LocaleStrings },
      errorCallback,
    });
    expect(sentConfig().customLocales).toEqual({});
    for (const listener of mockListeners.get('onGopayError') ?? []) {
      listener({
        callbackId: sentConfig().errorCallbackId,
        error: { code: 'NETWORK_004', message: 'Offline' },
      });
    }
    expect(errorCallback).toHaveBeenCalledTimes(1);
    expect(errorCallback.mock.calls[0]![0]).toBeInstanceOf(GopayError);
    expect(errorCallback.mock.calls[0]![0]).toMatchObject({ code: 'NETWORK_004' });
  });
});
