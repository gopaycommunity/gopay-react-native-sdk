/**
 * The props of `PaymentCardForm` beyond `formId` and `style`: its theme, its strings and its
 * validation display, with the checks the component runs before they cross the bridge.
 *
 * Names and shapes follow the native `PaymentCardFormTheme` and `GopayLocaleStrings`, which are the
 * same on iOS and Android. A key the theme leaves out keeps the native default, the colors that
 * follow light and dark mode included: the bridge never fills one in.
 */

/**
 * A color as a hex string: `#RRGGBB`, or `#RRGGBBAA` with the alpha last, as in CSS.
 * Case does not matter.
 */
export type HexColor = string;

/**
 * Appearance of `PaymentCardForm`, the 28 keys the native themes of iOS and Android share, named as
 * they are there (and after the GoPay web card form). Every key is optional; one left out keeps the
 * native default. Lengths are numbers in points on iOS and dp on Android; font sizes, line height
 * and letter spacing are points on iOS and sp on Android. Font weights are CSS numbers, 100 to 900.
 *
 * A key with a value the form cannot use (a color that is not hex, a length outside 0 to 1000, a
 * weight outside 100 to 900, a key the two native themes do not share) is left out with a warning
 * in development. The limits are in `PAYMENT_CARD_FORM_THEME_LIMITS`.
 */
export interface PaymentCardFormTheme {
  // Typography
  /**
   * Name of a font the app has, applied to every text in the form. A name the platform does not
   * find falls back to the system font. iOS looks it up with `UIFont(name:)` (the PostScript or full
   * name of a registered face); Android looks it up as React Native's `fontFamily` does (a font
   * loaded with `expo-font`, or one in `assets/fonts`).
   */
  readonly fontFamily?: string;

  // Labels
  readonly labelColor?: HexColor;
  readonly labelFontSize?: number;
  /** CSS weight, 100 to 900. */
  readonly labelFontWeight?: number;
  readonly labelLineHeight?: number;
  readonly labelUppercase?: boolean;
  /** -100 to 100; negative for tighter letters. */
  readonly labelLetterSpacing?: number;
  /** Hides the labels; they still name their field for screen readers. */
  readonly labelHidden?: boolean;

  // Input text
  readonly inputTextColor?: HexColor;
  readonly inputFontSize?: number;
  /** CSS weight, 100 to 900. */
  readonly inputFontWeight?: number;
  /** Smallest height of an input, its vertical padding included. 0 means none. */
  readonly inputHeight?: number;
  readonly placeholderColor?: HexColor;

  // Input border
  readonly inputBorderColor?: HexColor;
  readonly inputBorderWidth?: number;
  readonly inputBackgroundColor?: HexColor;
  readonly inputPaddingVertical?: number;
  readonly inputPaddingHorizontal?: number;
  readonly inputBorderRadius?: number;

  // Validation errors
  readonly inputErrorBorderColor?: HexColor;
  readonly errorTextColor?: HexColor;
  readonly errorFontSize?: number;
  /** Space reserved for the error line, so the form does not grow when a message shows. */
  readonly errorMinHeight?: number;
  /** Distance from an input to its error line; `fieldSpacing` when left out. */
  readonly errorSpacing?: number;

  // Layout
  readonly groupSpacing?: number;
  readonly fieldSpacing?: number;
  readonly formPadding?: number;
  readonly formBackgroundColor?: HexColor;
}

/**
 * The strings of `PaymentCardForm`, the 12 keys both native SDKs share, all required as they are
 * there: a partial translation would put a string of another language into the form.
 */
export interface GopayLocaleStrings {
  readonly panLabel: string;
  readonly panPlaceholder: string;
  readonly expLabel: string;
  readonly expPlaceholder: string;
  readonly cvvLabel: string;
  readonly cvvPlaceholder: string;
  /** The form has no button; the string is there for the app's own. */
  readonly pay: string;
  readonly panErrorPattern: string;
  readonly expErrorPattern: string;
  readonly cvvErrorPattern: string;
  readonly patternErrorMessage: string;
  readonly requiredErrorMessage: string;
  /**
   * iOS only: the text over the form while the screen is recorded or mirrored, when the iOS form
   * hides its fields. Left out, the cover shows no text, as in the iOS SDK. Android has no such
   * cover (the window is kept out of captures with `FLAG_SECURE`) and ignores it.
   */
  readonly screenCaptureNotice?: string;
}

/**
 * When the form shows its inline errors, as the native `PaymentCardFormValidationDisplay`:
 * - `'hidden'` (default): never; the app shows its own.
 * - `'live'`: a field once the user is done with it, and after a submit every field the user has
 *   typed into; an empty field is never marked in this mode.
 * - `'onSubmit'`: every invalid field while `submitAttempted` is `true`.
 */
export type PaymentCardFormValidation = 'hidden' | 'live' | 'onSubmit';

/**
 * The largest values the theme takes, the same on both platforms (points on iOS, dp and sp on
 * Android). Far above any real form; they keep a value from untyped JS or a typo from reaching a
 * layout that cannot hold it (Android measures in 32-bit floats and fails on such sizes).
 */
export const PAYMENT_CARD_FORM_THEME_LIMITS = {
  /** Every length: heights, widths, paddings, radius, spacings, 0 to this. */
  length: 1000,
  /** Font sizes, above 0 up to this. */
  fontSize: 200,
  /** `labelLineHeight`, above 0 up to this. */
  lineHeight: 400,
  /** `labelLetterSpacing`, from minus this to this. */
  letterSpacing: 100,
} as const;

type Check = { test: (value: unknown) => boolean; expected: string };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const color: Check = {
  test: (value) => typeof value === 'string' && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value),
  expected: 'a hex color, #RRGGBB or #RRGGBBAA',
};
const limits = PAYMENT_CARD_FORM_THEME_LIMITS;
const above0UpTo = (max: number): Check => ({
  test: (value) => isFiniteNumber(value) && value > 0 && value <= max,
  expected: `a number above 0 up to ${max}`,
});
const fontSize = above0UpTo(limits.fontSize);
const length: Check = {
  test: (value) => isFiniteNumber(value) && value >= 0 && value <= limits.length,
  expected: `a number from 0 to ${limits.length}`,
};
const weight: Check = {
  test: (value) => Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 900,
  expected: 'a whole number from 100 to 900',
};
const flag: Check = { test: (value) => typeof value === 'boolean', expected: 'true or false' };

/** What each key takes. Typed against the theme, so a key missing here fails the typecheck. */
const CHECKS: Record<keyof PaymentCardFormTheme, Check> = {
  fontFamily: {
    test: (value) => typeof value === 'string' && value.trim().length > 0,
    expected: 'a font name',
  },
  labelColor: color,
  labelFontSize: fontSize,
  labelFontWeight: weight,
  labelLineHeight: above0UpTo(limits.lineHeight),
  labelUppercase: flag,
  labelLetterSpacing: {
    test: (value) => isFiniteNumber(value) && Math.abs(value) <= limits.letterSpacing,
    expected: `a number from -${limits.letterSpacing} to ${limits.letterSpacing}`,
  },
  labelHidden: flag,
  inputTextColor: color,
  inputFontSize: fontSize,
  inputFontWeight: weight,
  inputHeight: length,
  placeholderColor: color,
  inputBorderColor: color,
  inputBorderWidth: length,
  inputBackgroundColor: color,
  inputPaddingVertical: length,
  inputPaddingHorizontal: length,
  inputBorderRadius: length,
  inputErrorBorderColor: color,
  errorTextColor: color,
  errorFontSize: fontSize,
  errorMinHeight: length,
  errorSpacing: length,
  groupSpacing: length,
  fieldSpacing: length,
  formPadding: length,
  formBackgroundColor: color,
};

/** The 28 theme keys both native SDKs share. Exported for the tests that hold the mappers to them. */
export const PAYMENT_CARD_FORM_THEME_KEYS = Object.keys(CHECKS) as (keyof PaymentCardFormTheme)[];

/** The 12 locale keys both native SDKs share. */
export const GOPAY_LOCALE_STRINGS_KEYS = [
  'panLabel',
  'panPlaceholder',
  'expLabel',
  'expPlaceholder',
  'cvvLabel',
  'cvvPlaceholder',
  'pay',
  'panErrorPattern',
  'expErrorPattern',
  'cvvErrorPattern',
  'patternErrorMessage',
  'requiredErrorMessage',
] as const satisfies readonly (keyof GopayLocaleStrings)[];

const PAYMENT_CARD_FORM_VALIDATIONS: readonly PaymentCardFormValidation[] = [
  'hidden',
  'live',
  'onSubmit',
];

/** Warnings already given, so a re-render or Strict Mode does not repeat them. */
const warned = new Set<string>();

/** Development only: tells a problem with a prop once per app run. */
export function warnOnce(message: string) {
  if (!__DEV__ || warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** For tests: forget the warnings given, so each test sees its own. */
export function resetWarningsForTests() {
  warned.clear();
}

const describeValue = (value: unknown) => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value === null ? 'null' : typeof value;
};

/**
 * A plain object, as JS writes one in braces: its prototype is `Object.prototype` or `null`. A
 * `Map`, an array, a class instance or a function is not; their entries would not cross the bridge.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const describeObject = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? (Object.getPrototypeOf(value)?.constructor?.name ?? 'object')
    : describeValue(value);

/**
 * The theme as it goes to the native view: the keys with a usable value, unchanged. A key with a
 * value the form cannot use, or one the two native themes do not share, is left out with a warning
 * in development, the same on both platforms, so that the native form keeps its default there and
 * never fails on it. A key that is `undefined` or `null` is simply left out. Not a plain object: no
 * theme at all.
 */
export function sanitizeTheme(theme: unknown): PaymentCardFormTheme | undefined {
  if (theme === undefined || theme === null) return undefined;
  if (!isPlainObject(theme)) {
    warnOnce(
      `PaymentCardForm theme must be a plain object, got ${describeObject(theme)}: no theme is ` +
        'applied.'
    );
    return undefined;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(theme)) {
    if (value === undefined || value === null) continue;
    // Own keys only: `constructor` or `toString` would otherwise find the object's prototype.
    const check = Object.prototype.hasOwnProperty.call(CHECKS, key)
      ? CHECKS[key as keyof PaymentCardFormTheme]
      : undefined;
    if (!check) {
      warnOnce(
        `PaymentCardForm theme key "${key}" is not one the iOS and Android themes share, it is ` +
          'ignored.'
      );
    } else if (!check.test(value)) {
      warnOnce(
        `PaymentCardForm theme.${key} must be ${check.expected}, got ${describeValue(value)}: ` +
          'the key is ignored and the form keeps its default.'
      );
    } else {
      clean[key] = value;
    }
  }
  return clean as PaymentCardFormTheme;
}

/**
 * The strings as they cross the bridge, or `undefined` with a warning in development when one of
 * the 12 keys is missing or not a string: the native SDKs take only a complete set, so the form
 * then follows `locale` instead. A `screenCaptureNotice` that is not a string is left out. `name`
 * and `instead` say in the warning which prop it is and what happens without it.
 */
export function sanitizeLocaleStrings(
  strings: unknown,
  name = 'PaymentCardForm localeStrings',
  instead = 'the form follows locale instead'
): GopayLocaleStrings | undefined {
  if (strings === undefined || strings === null) return undefined;
  if (!isPlainObject(strings)) {
    warnOnce(`${name} must be a plain object, got ${describeObject(strings)}: ${instead}.`);
    return undefined;
  }
  const record = strings;
  const missing = GOPAY_LOCALE_STRINGS_KEYS.filter((key) => typeof record[key] !== 'string');
  if (missing.length > 0) {
    warnOnce(`${name} needs every key as a string, missing ${missing.join(', ')}: ${instead}.`);
    return undefined;
  }
  const clean: Record<string, string> = {};
  for (const key of GOPAY_LOCALE_STRINGS_KEYS) clean[key] = record[key] as string;
  if (typeof record.screenCaptureNotice === 'string') {
    clean.screenCaptureNotice = record.screenCaptureNotice;
  } else if (record.screenCaptureNotice !== undefined && record.screenCaptureNotice !== null) {
    warnOnce(`${name}.screenCaptureNotice must be a string, it is ignored.`);
  }
  return clean as unknown as GopayLocaleStrings;
}

/**
 * `GopayConfig.customLocales` as it crosses the bridge: every entry whose strings are complete,
 * under its code as given. An entry with a key missing is left out with a warning in development,
 * the same check as `localeStrings`, so that `initialize` never fails on it. Not a plain object:
 * none. Two codes the native SDKs read as one language (`'cs'` and `'cs-CZ'`) are both passed, with a
 * warning: which of them wins is not defined.
 */
export function sanitizeCustomLocales(
  locales: unknown
): Record<string, GopayLocaleStrings> | undefined {
  if (locales === undefined || locales === null) return undefined;
  if (!isPlainObject(locales)) {
    warnOnce(
      `GopayConfig.customLocales must be a plain object of locale codes, got ` +
        `${describeObject(locales)}: no custom locale is registered.`
    );
    return undefined;
  }
  const clean: Record<string, GopayLocaleStrings> = {};
  const codesByLanguage = new Map<string, string>();
  for (const [code, strings] of Object.entries(locales)) {
    const valid = sanitizeLocaleStrings(
      strings,
      `GopayConfig.customLocales[${JSON.stringify(code)}]`,
      'the entry is not registered'
    );
    if (!valid) continue;
    clean[code] = valid;
    for (const language of new Set(localeLanguages(code))) {
      const earlier = codesByLanguage.get(language);
      if (earlier !== undefined) {
        warnOnce(
          `GopayConfig.customLocales has ${JSON.stringify(earlier)} and ${JSON.stringify(code)}, ` +
            `which a native SDK reads both as "${language}": which of them the form uses is not ` +
            'defined. Keep one code per language.'
        );
      } else {
        codesByLanguage.set(language, code);
      }
    }
  }
  return clean;
}

/**
 * The language part of a locale code as each native SDK reduces it (`'cs-CZ'` and `'cs_CZ'` are
 * `'cs'` on both): Android takes what comes before the first separator, iOS the first part that is
 * not empty, so `'-cs'` is `''` on Android and `'cs'` on iOS.
 */
function localeLanguages(code: string): [android: string, ios: string] {
  const parts = code.trim().toLowerCase().split(/[-_]/);
  return [parts[0]!, parts.find((part) => part.length > 0) ?? ''];
}

/** The validation display, or `undefined` (the native default) with a warning for another value. */
export function sanitizeValidation(validation: unknown): PaymentCardFormValidation | undefined {
  if (validation === undefined || validation === null) return undefined;
  if (PAYMENT_CARD_FORM_VALIDATIONS.includes(validation as PaymentCardFormValidation)) {
    return validation as PaymentCardFormValidation;
  }
  warnOnce(
    `PaymentCardForm validation must be 'hidden', 'live' or 'onSubmit', got ` +
      `${describeValue(validation)}: the form keeps its default, 'hidden'.`
  );
  return undefined;
}
