import { act, StrictMode } from 'react';
import type { ViewStyle } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

/** The host element the mocked native view renders as. */
const NATIVE_VIEW = 'NativePaymentCardForm';
/** How many times the mocked native view was mounted, as a native view would be created. */
let mockNativeViewMounts = 0;
const mockRequireNativeView = jest.fn((_module: string) => {
  const { createElement, useEffect } = require('react') as typeof import('react');
  return function MockNativePaymentCardForm(props: object) {
    useEffect(() => {
      mockNativeViewMounts += 1;
    }, []);
    return createElement(NATIVE_VIEW, props);
  };
});

jest.mock('expo', () => ({
  NativeModule: class {},
  requireNativeModule: () => ({}),
  requireNativeView: (module: string) => mockRequireNativeView(module),
}));

// Required, not imported: imports are hoisted above the mock factory's variables.
const { PaymentCardForm } = require('../index') as typeof import('../index');
const { NATIVE_MODULE_NAME } =
  require('../GopayReactNativeSDKModule') as typeof import('../GopayReactNativeSDKModule');
const { StyleSheet } = require('react-native') as typeof import('react-native');
const { resetWarningsForTests, PAYMENT_CARD_FORM_THEME_KEYS, GOPAY_LOCALE_STRINGS_KEYS } =
  require('../cardForm') as typeof import('../cardForm');
type Theme = import('../cardForm').PaymentCardFormTheme;
type LocaleStrings = import('../cardForm').GopayLocaleStrings;
const requiredViews = mockRequireNativeView.mock.calls.map(([module]) => module);

let root: Root;
let warn: jest.SpyInstance;

beforeEach(() => {
  resetWarningsForTests();
  root = createRoot();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  warn.mockRestore();
});

const render = async (element: React.ReactElement) => {
  await act(async () => root.render(element));
};

/** The one native view rendered. */
const nativeView = (): TestInstance => {
  const found = root.container.queryAll((node) => node.type === NATIVE_VIEW);
  expect(found).toHaveLength(1);
  return found[0]!;
};

const style = (): ViewStyle => StyleSheet.flatten(nativeView().props.style) ?? {};

/** React Native reporting the layout of the native view. */
const layOut = async (width: number) => {
  await act(async () =>
    nativeView().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } })
  );
};

/** The native view reporting the validity of its form. */
const reportValidity = async (isValid: boolean) => {
  await act(async () => nativeView().props.onFormValidityChange({ nativeEvent: { isValid } }));
};

/** How many submit flag changes the mocked native view has reported, as native numbers them. */
let reportedSeq = 0;

/** The native view reporting that the SDK changed the submit flag, numbered as native does. */
const reportSubmitAttempted = async (attempted: boolean) => {
  reportedSeq += 1;
  const seq = reportedSeq;
  await act(async () =>
    nativeView().props.onFormSubmitAttemptedChange({ nativeEvent: { attempted, seq } })
  );
  return seq;
};

/** A theme with every one of the 28 keys. */
const FULL_THEME: Required<Theme> = {
  fontFamily: 'Inter-Regular',
  labelColor: '#112233',
  labelFontSize: 13,
  labelFontWeight: 600,
  labelLineHeight: 18,
  labelUppercase: true,
  labelLetterSpacing: -0.5,
  labelHidden: false,
  inputTextColor: '#000000',
  inputFontSize: 17,
  inputFontWeight: 400,
  inputHeight: 48,
  placeholderColor: '#88888880',
  inputBorderColor: '#CCCCCC',
  inputBorderWidth: 1.5,
  inputBackgroundColor: '#FFFFFF',
  inputPaddingVertical: 10,
  inputPaddingHorizontal: 12,
  inputBorderRadius: 8,
  inputErrorBorderColor: '#ff3b30',
  errorTextColor: '#FF3B30',
  errorFontSize: 12,
  errorMinHeight: 16,
  errorSpacing: 4,
  groupSpacing: 16,
  fieldSpacing: 6,
  formPadding: 0,
  formBackgroundColor: '#00000000',
};

const STRINGS: LocaleStrings = {
  panLabel: 'Card number',
  panPlaceholder: '1234 1234 1234 1234',
  expLabel: 'Expiry',
  expPlaceholder: 'MM/YY',
  cvvLabel: 'CVV',
  cvvPlaceholder: '123',
  pay: 'Pay',
  panErrorPattern: 'Invalid card number',
  expErrorPattern: 'Invalid expiry',
  cvvErrorPattern: 'Invalid CVV',
  patternErrorMessage: 'Wrong format',
  requiredErrorMessage: 'Required',
};

/** The props of the native view other than formId, style, the events and onLayout. */
const PUBLIC_PROPS = [
  'theme',
  'locale',
  'localeStrings',
  'validation',
  'allowsAutofill',
  'submitAttempted',
];

/** The native view reporting the height of its form. */
const reportHeight = async (height: number) => {
  await act(async () => nativeView().props.onFormHeightChange({ nativeEvent: { height } }));
};

describe('PaymentCardForm', () => {
  it('is the view of the one native module', () => {
    expect(requiredViews).toEqual([NATIVE_MODULE_NAME]);
  });

  it('passes the formId to the native view as it is', async () => {
    await render(<PaymentCardForm formId=" Checkout Form " />);
    expect(nativeView().props.formId).toBe(' Checkout Form ');

    await render(<PaymentCardForm formId="other" />);
    expect(nativeView().props.formId).toBe('other');
  });

  it('keeps the native view mounted when the formId changes, so the typed card stays', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    const mounts = mockNativeViewMounts;
    expect(mounts).toBeGreaterThan(0);

    await render(<PaymentCardForm formId="other" />);
    expect(nativeView().props.formId).toBe('other');
    // A remount (e.g. key={formId}) would wipe the card; the native SDK moves it to the new id.
    expect(mockNativeViewMounts).toBe(mounts);
  });

  it('has no height of its own until the native view reports one', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    expect(style().height).toBeUndefined();
  });

  it('takes the height the native view reports, and each new one', async () => {
    await render(<PaymentCardForm formId="checkout" style={{ marginTop: 8 }} />);
    await reportHeight(212.5);
    expect(style()).toEqual({ height: 212.5, marginTop: 8 });

    await reportHeight(240);
    expect(style().height).toBe(240);
  });

  it('keeps a height the style sets over the reported one', async () => {
    await render(<PaymentCardForm formId="checkout" style={{ height: 300 }} />);
    await reportHeight(212.5);
    expect(style().height).toBe(300);
  });

  it('keeps a height inside an array of styles over the reported one', async () => {
    await render(<PaymentCardForm formId="checkout" style={[{ marginTop: 8 }, { height: 300 }]} />);
    await reportHeight(212.5);
    expect(style()).toEqual({ height: 300, marginTop: 8 });
  });

  it('warns once in development when its parent gives it no width', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    await layOut(0);
    await layOut(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('"checkout" has no width');
  });

  it('does not warn about a form that has a width', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    await layOut(390);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about no width once per form in Strict Mode too', async () => {
    await render(
      <StrictMode>
        <PaymentCardForm formId="checkout" />
      </StrictMode>
    );
    await layOut(0);
    await layOut(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns in development when formId is not a string', async () => {
    const Untyped = PaymentCardForm as unknown as React.ComponentType<{ formId?: unknown }>;
    await render(<Untyped />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('needs a formId string'));
  });

  it('renders one native view in Strict Mode and keeps the reported height', async () => {
    await render(
      <StrictMode>
        <PaymentCardForm formId="checkout" />
      </StrictMode>
    );
    await reportHeight(180);
    expect(nativeView().props.formId).toBe('checkout');
    expect(style().height).toBe(180);
  });
});

describe('PaymentCardForm props', () => {
  it('passes no prop that was left out, so the native form keeps its defaults', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    for (const prop of PUBLIC_PROPS) expect(nativeView().props).not.toHaveProperty(prop);
  });

  it('passes every prop to the native view under the same name and unchanged', async () => {
    await render(
      <PaymentCardForm
        formId="checkout"
        theme={FULL_THEME}
        locale="de"
        localeStrings={STRINGS}
        validation="onSubmit"
        allowsAutofill
        submitAttempted={false}
      />
    );
    const props = nativeView().props;
    expect(props.theme).toEqual(FULL_THEME);
    expect(props.locale).toBe('de');
    expect(props.localeStrings).toEqual(STRINGS);
    expect(props.validation).toBe('onSubmit');
    expect(props.allowsAutofill).toBe(true);
    expect(props.submitAttempted).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lists 28 theme keys and 12 locale keys, those of the full theme and strings here', () => {
    expect(PAYMENT_CARD_FORM_THEME_KEYS).toHaveLength(28);
    expect([...PAYMENT_CARD_FORM_THEME_KEYS].sort()).toEqual(Object.keys(FULL_THEME).sort());
    expect(GOPAY_LOCALE_STRINGS_KEYS).toHaveLength(12);
    expect([...GOPAY_LOCALE_STRINGS_KEYS].sort()).toEqual(Object.keys(STRINGS).sort());
  });

  it('passes each validation mode and false values as they are', async () => {
    for (const validation of ['hidden', 'live', 'onSubmit'] as const) {
      await render(
        <PaymentCardForm formId="checkout" validation={validation} allowsAutofill={false} />
      );
      expect(nativeView().props.validation).toBe(validation);
      expect(nativeView().props.allowsAutofill).toBe(false);
    }
  });

  it('passes only the theme keys that were set', async () => {
    await render(<PaymentCardForm formId="checkout" theme={{ labelColor: '#123456' }} />);
    expect(nativeView().props.theme).toEqual({ labelColor: '#123456' });
  });

  it('passes screenCaptureNotice with the strings when it is set', async () => {
    const strings = { ...STRINGS, screenCaptureNotice: 'Hidden while recording' };
    await render(<PaymentCardForm formId="checkout" localeStrings={strings} />);
    expect(nativeView().props.localeStrings).toEqual(strings);
  });

  it('keeps the native view mounted when every other prop changes, so the typed card stays', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    const mounts = mockNativeViewMounts;

    await render(
      <PaymentCardForm
        formId="checkout"
        theme={FULL_THEME}
        locale="en"
        localeStrings={STRINGS}
        validation="live"
        allowsAutofill
        submitAttempted
        onValidityChange={() => {}}
        onSubmitAttemptedChange={() => {}}
      />
    );
    await render(
      <PaymentCardForm
        formId="checkout"
        theme={{ ...FULL_THEME, labelColor: '#000000' }}
        locale="cs"
        validation="onSubmit"
        allowsAutofill={false}
        submitAttempted={false}
      />
    );
    await render(<PaymentCardForm formId="checkout" />);
    expect(nativeView().props.theme).toBeUndefined();
    expect(mockNativeViewMounts).toBe(mounts);
  });

  it('passes the same theme object again for the same content written inline', async () => {
    await render(<PaymentCardForm formId="checkout" theme={{ ...FULL_THEME }} />);
    const first = nativeView().props.theme;
    await render(<PaymentCardForm formId="checkout" theme={{ ...FULL_THEME }} />);
    expect(nativeView().props.theme).toBe(first);
    await render(<PaymentCardForm formId="checkout" theme={{ ...FULL_THEME, formPadding: 4 }} />);
    expect(nativeView().props.theme).not.toBe(first);
    expect(nativeView().props.theme.formPadding).toBe(4);
  });
});

describe('PaymentCardForm theme checks', () => {
  const invalid: [keyof Theme, unknown][] = [
    ['labelColor', 'red'],
    ['labelColor', '#12345'],
    ['inputTextColor', '#1234567'],
    ['formBackgroundColor', 'rgba(0,0,0,0)'],
    ['labelFontSize', 0],
    ['inputFontSize', -1],
    ['errorFontSize', Number.NaN],
    ['inputBorderWidth', -1],
    ['groupSpacing', Number.POSITIVE_INFINITY],
    ['formPadding', '16'],
    ['labelFontWeight', 950],
    ['inputFontWeight', 450.5],
    ['labelFontWeight', 50],
    ['labelLineHeight', 0],
    ['labelLetterSpacing', Number.NaN],
    ['labelUppercase', 'yes'],
    ['labelHidden', 1],
    ['fontFamily', ''],
    ['fontFamily', 12],
    ['inputHeight', 100000],
    ['formPadding', 1e39],
    ['groupSpacing', 1000.5],
    ['labelFontSize', 201],
    ['labelLineHeight', 401],
    ['labelLetterSpacing', -101],
    ['labelLetterSpacing', 101],
  ];

  it.each(invalid)(
    'ignores %s = %p with a warning and keeps the other keys',
    async (key, value) => {
      const theme = { formPadding: 8, [key]: value } as unknown as Theme;
      await render(<PaymentCardForm formId="checkout" theme={theme} />);
      const passed = nativeView().props.theme;
      expect(passed).not.toHaveProperty(key);
      if (key !== 'formPadding') expect(passed.formPadding).toBe(8);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain(`theme.${key} must be`);
    }
  );

  it('ignores a key the two native themes do not share, with a warning', async () => {
    const theme = { helperTextColor: '#000000', constructor: 1 } as unknown as Theme;
    await render(<PaymentCardForm formId="checkout" theme={theme} />);
    expect(nativeView().props.theme).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('key "helperTextColor" is not one'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('key "constructor" is not one'));
  });

  it('accepts the limits, negative letter spacing, zero lengths and 8-digit colors', async () => {
    const theme: Theme = {
      labelLetterSpacing: -100,
      inputHeight: 0,
      errorMinHeight: 0,
      formPadding: 1000,
      inputFontSize: 200,
      labelLineHeight: 400,
      labelColor: '#AABBCC80',
    };
    await render(<PaymentCardForm formId="checkout" theme={theme} />);
    expect(nativeView().props.theme).toEqual(theme);
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips undefined and null keys silently', async () => {
    const theme = { labelColor: undefined, inputTextColor: null } as unknown as Theme;
    await render(<PaymentCardForm formId="checkout" theme={theme} />);
    expect(nativeView().props.theme).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it('applies no theme that is not an object', async () => {
    await render(<PaymentCardForm formId="checkout" theme={'dark' as unknown as Theme} />);
    expect(nativeView().props).not.toHaveProperty('theme');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('theme must be a plain object'));
  });

  it.each([
    ['a Map', new Map([['labelColor', '#000000']]), 'Map'],
    ['a class instance', new (class Theme {})(), 'Theme'],
    ['an array', ['#000000'], 'Array'],
  ])('applies no theme that is %s, with a warning', async (_name, theme, constructor) => {
    await render(<PaymentCardForm formId="checkout" theme={theme as unknown as Theme} />);
    expect(nativeView().props).not.toHaveProperty('theme');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`plain object, got ${constructor}`));
  });

  it('takes a theme without a prototype', async () => {
    const theme = Object.assign(Object.create(null), { labelColor: '#000000' }) as Theme;
    await render(<PaymentCardForm formId="checkout" theme={theme} />);
    expect(nativeView().props.theme).toEqual({ labelColor: '#000000' });
  });

  it('checks a theme JSON cannot write on every render instead of reusing the last one', async () => {
    const cyclic = (color: string) => {
      const theme: Record<string, unknown> = { labelColor: color };
      theme.self = theme;
      return theme as unknown as Theme;
    };
    await render(<PaymentCardForm formId="checkout" theme={cyclic('#111111')} />);
    expect(nativeView().props.theme.labelColor).toBe('#111111');
    await render(<PaymentCardForm formId="checkout" theme={cyclic('#222222')} />);
    expect(nativeView().props.theme.labelColor).toBe('#222222');
  });

  it('warns once for the same invalid value across renders', async () => {
    const theme = { labelColor: 'red' } as Theme;
    await render(<PaymentCardForm formId="checkout" theme={theme} />);
    await render(<PaymentCardForm formId="checkout" theme={{ ...theme }} />);
    await render(<PaymentCardForm formId="other" theme={{ ...theme }} />);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentCardForm other prop checks', () => {
  it('leaves out strings that miss a key, so the form follows locale, with a warning', async () => {
    const { cvvLabel: _omitted, ...partial } = STRINGS;
    await render(
      <PaymentCardForm
        formId="checkout"
        locale="cs"
        localeStrings={partial as unknown as LocaleStrings}
      />
    );
    expect(nativeView().props).not.toHaveProperty('localeStrings');
    expect(nativeView().props.locale).toBe('cs');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing cvvLabel'));
  });

  it('leaves out a validation mode the form does not have, with a warning', async () => {
    await render(<PaymentCardForm formId="checkout" validation={'always' as unknown as 'live'} />);
    expect(nativeView().props).not.toHaveProperty('validation');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("validation must be 'hidden'"));
  });

  it('leaves out a locale, autofill or submit flag of the wrong type, with a warning', async () => {
    const Untyped = PaymentCardForm as unknown as React.ComponentType<Record<string, unknown>>;
    await render(<Untyped formId="checkout" locale={5} allowsAutofill="yes" submitAttempted={1} />);
    for (const prop of ['locale', 'allowsAutofill', 'submitAttempted']) {
      expect(nativeView().props).not.toHaveProperty(prop);
    }
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('PaymentCardForm events', () => {
  it('tells onValidityChange the boolean the native view reports', async () => {
    const onValidityChange = jest.fn();
    await render(<PaymentCardForm formId="checkout" onValidityChange={onValidityChange} />);
    await reportValidity(false);
    await reportValidity(true);
    expect(onValidityChange.mock.calls).toEqual([[false], [true]]);
  });

  it('tells the latest onValidityChange after it changed', async () => {
    const first = jest.fn();
    const second = jest.fn();
    await render(<PaymentCardForm formId="checkout" onValidityChange={first} />);
    await render(<PaymentCardForm formId="checkout" onValidityChange={second} />);
    await reportValidity(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(true);
  });

  it('takes the events without callbacks', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    await reportValidity(true);
    await reportSubmitAttempted(true);
  });

  it('tells onSubmitAttemptedChange the boolean the native view reports', async () => {
    const onSubmitAttemptedChange = jest.fn();
    await render(
      <PaymentCardForm
        formId="checkout"
        submitAttempted={false}
        onSubmitAttemptedChange={onSubmitAttemptedChange}
      />
    );
    await reportSubmitAttempted(true);
    await reportSubmitAttempted(false);
    expect(onSubmitAttemptedChange.mock.calls).toEqual([[true], [false]]);
  });
});

describe('PaymentCardForm controlled submitAttempted', () => {
  /** An app that stores what the form reports and passes it back, counting the events. */
  function ControlledForm(props: { onEvent: (attempted: boolean) => void; store: boolean }) {
    const { useState } = require('react') as typeof import('react');
    const [attempted, setAttempted] = useState(false);
    return (
      <PaymentCardForm
        formId="checkout"
        validation="onSubmit"
        submitAttempted={attempted}
        onSubmitAttemptedChange={(value) => {
          props.onEvent(value);
          if (props.store) setAttempted(value);
        }}
      />
    );
  }

  it('keeps the value from JS when the app does not store what the SDK reports', async () => {
    const onEvent = jest.fn();
    await render(<ControlledForm onEvent={onEvent} store={false} />);
    await reportSubmitAttempted(true);
    expect(onEvent.mock.calls).toEqual([[true]]);
    expect(nativeView().props.submitAttempted).toBe(false);
  });

  it('adds no event of its own when the stored value comes back', async () => {
    const onEvent = jest.fn();
    await render(<ControlledForm onEvent={onEvent} store />);
    await reportSubmitAttempted(true);
    expect(nativeView().props.submitAttempted).toBe(true);
    await reportSubmitAttempted(false);
    expect(nativeView().props.submitAttempted).toBe(false);
    // One call per event from the native view; the values passed back raised none.
    expect(onEvent.mock.calls).toEqual([[true], [false]]);
  });

  it('adds no event of its own when the app changes the flag', async () => {
    const onSubmitAttemptedChange = jest.fn();
    await render(
      <PaymentCardForm
        formId="checkout"
        submitAttempted={false}
        onSubmitAttemptedChange={onSubmitAttemptedChange}
      />
    );
    await render(
      <PaymentCardForm
        formId="checkout"
        submitAttempted
        onSubmitAttemptedChange={onSubmitAttemptedChange}
      />
    );
    expect(nativeView().props.submitAttempted).toBe(true);
    expect(onSubmitAttemptedChange).not.toHaveBeenCalled();
  });

  it('answers each report with its number, so the native view stops holding it', async () => {
    const onEvent = jest.fn();
    await render(<ControlledForm onEvent={onEvent} store={false} />);
    expect(nativeView().props).not.toHaveProperty('submitAttemptedAck');
    const seq = await reportSubmitAttempted(true);
    // The app did not store true, so false is the flag again once native has the answer.
    expect(nativeView().props.submitAttemptedAck).toBe(seq);
    expect(nativeView().props.submitAttempted).toBe(false);
  });

  it('answers two quick reports with the number of the last, beside the stored value', async () => {
    const onEvent = jest.fn();
    await render(<ControlledForm onEvent={onEvent} store />);
    // A failed submit and clearCardFormData in its catch: true, then false at once.
    await reportSubmitAttempted(true);
    const last = await reportSubmitAttempted(false);
    expect(onEvent.mock.calls).toEqual([[true], [false]]);
    expect(nativeView().props.submitAttempted).toBe(false);
    expect(nativeView().props.submitAttemptedAck).toBe(last);
  });

  it('passes no answer while submitAttempted is left out', async () => {
    await render(<PaymentCardForm formId="checkout" submitAttempted={false} />);
    await reportSubmitAttempted(true);
    await render(<PaymentCardForm formId="checkout" />);
    expect(nativeView().props).not.toHaveProperty('submitAttemptedAck');
    expect(nativeView().props).not.toHaveProperty('submitAttempted');
  });
});
