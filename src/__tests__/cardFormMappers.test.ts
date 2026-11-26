/**
 * The native mappers of the card form props read the keys the JS layer checks, under the same names,
 * and keep the same limits: a typo in Swift or Kotlin would otherwise drop a key on one platform
 * without a sound. Read from the sources, as no native code runs in Jest.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  GOPAY_LOCALE_STRINGS_KEYS,
  PAYMENT_CARD_FORM_THEME_KEYS,
  PAYMENT_CARD_FORM_THEME_LIMITS,
} from '../cardForm';

// Hoisted by Jest above the imports; `../index` loads the native module.
jest.mock('expo', () => ({
  NativeModule: class {},
  requireNativeModule: () => ({}),
  requireNativeView: () => 'NativePaymentCardForm',
}));

const read = (path: string) => readFileSync(join(__dirname, '..', '..', path), 'utf8');
const swift = read('ios/PaymentCardFormProps.swift');
const kotlin = read('android/src/main/java/cz/gopay/reactnative/PaymentCardFormProps.kt');

/** The part of `source` from `start` to the first line after it that is exactly `end`. */
function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(`\n${end}\n`, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

/** Every first string argument of `pattern` in `source`, in order. */
const keys = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].map((match) => match[1]!);

const sorted = (values: readonly string[]) => [...values].sort();

describe('the theme limits', () => {
  it('are exported by the package, read-only, as the checks use them', () => {
    const { PAYMENT_CARD_FORM_THEME_LIMITS: exported } =
      require('../index') as typeof import('../index');
    expect(exported).toBe(PAYMENT_CARD_FORM_THEME_LIMITS);
    expect(exported).toEqual({ length: 1000, fontSize: 200, lineHeight: 400, letterSpacing: 100 });
    // Read-only to TypeScript: declared `as const`. The typecheck leaves the tests out, so the
    // declaration is read instead of an assignment that must not compile.
    expect(
      block(
        read('src/cardForm.ts'),
        'export const PAYMENT_CARD_FORM_THEME_LIMITS = {',
        '} as const;'
      )
    ).toBeTruthy();
  });
});

describe('the native mappers of the card form', () => {
  const themeKeys = sorted(PAYMENT_CARD_FORM_THEME_KEYS);
  const localeKeys = sorted(GOPAY_LOCALE_STRINGS_KEYS);

  it('read every theme key once on iOS', () => {
    const mapper = block(swift, 'init(bridged values: [String: Any]?) {\n    self.init()', '  }');
    expect(sorted(keys(mapper, /read\.\w+\("(\w+)"\)/g))).toEqual(themeKeys);
  });

  it('read every theme key once on Android', () => {
    const mapper = block(kotlin, 'internal fun bridgedTheme(', '}');
    expect(sorted(keys(mapper, /read\.\w+\("(\w+)"\)/g))).toEqual(themeKeys);
  });

  it('read each theme key with the same kind of value and limit on both, the one JS checks', () => {
    // The kind JS checks each key as (src/cardForm.ts CHECKS), named as the mappers' reads.
    const kinds: Record<string, string> = {
      fontFamily: 'string',
      labelLineHeight: 'lineHeight',
      labelLetterSpacing: 'letterSpacing',
      labelUppercase: 'bool',
      labelHidden: 'bool',
      labelFontWeight: 'weight',
      inputFontWeight: 'weight',
    };
    for (const key of themeKeys) {
      if (kinds[key]) continue;
      if (key.endsWith('Color')) kinds[key] = 'color';
      else if (key.endsWith('FontSize')) kinds[key] = 'fontSize';
      else kinds[key] = 'length';
    }
    const readsOf = (mapper: string) =>
      Object.fromEntries([...mapper.matchAll(/read\.(\w+)\("(\w+)"\)/g)].map((m) => [m[2], m[1]]));
    const ios = readsOf(
      block(swift, 'init(bridged values: [String: Any]?) {\n    self.init()', '  }')
    );
    const android = readsOf(block(kotlin, 'internal fun bridgedTheme(', '}'));
    expect(ios).toEqual(kinds);
    expect(android).toEqual(kinds);
  });

  it('read the 12 locale keys on both, and screenCaptureNotice on iOS only', () => {
    const ios = block(swift, 'init?(bridged values: [String: Any]?) {', '  }');
    expect(sorted(keys(ios, /values\["(\w+)"\]/g))).toEqual(
      sorted([...localeKeys, 'screenCaptureNotice'])
    );
    const android = block(kotlin, 'internal fun bridgedLocaleStrings(', '}');
    expect(sorted(keys(android, /text\("(\w+)"\)/g))).toEqual(localeKeys);
  });

  it('keep the limits of the JS layer', () => {
    const swiftLimits = block(swift, 'private enum ThemeLimits {', '}');
    const kotlinLimits = block(kotlin, 'private object ThemeLimits {', '}');
    for (const [name, value] of Object.entries(PAYMENT_CARD_FORM_THEME_LIMITS)) {
      expect(swiftLimits).toMatch(new RegExp(`static let ${name} = ${value}\\.0\\b`));
      const constant = name.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
      expect(kotlinLimits).toMatch(new RegExp(`const val ${constant} = ${value}\\.0\\b`));
    }
  });
});
