import { requireNativeView } from 'expo';
import { useCallback, useMemo, useRef, useState, type ComponentType } from 'react';
import type { LayoutChangeEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

import { NATIVE_MODULE_NAME } from './GopayReactNativeSDKModule';
import {
  sanitizeLocaleStrings,
  sanitizeTheme,
  sanitizeValidation,
  warnOnce,
  type GopayLocaleStrings,
  type PaymentCardFormTheme,
  type PaymentCardFormValidation,
} from './cardForm';

export interface PaymentCardFormProps {
  /**
   * Identifies the form to `GopaySDK.submitCardForm`, `submitCardFormWithMetadata` and
   * `clearCardFormData`. Keep one form on screen per `formId`. Required, unlike in the native
   * SDKs, where a missing id means the form that was active last. Changing it on a mounted form
   * moves the form and the card typed into it to the new id.
   */
  formId: string;
  /**
   * Laid out by the parent, which must give the form its width. The height is the form's own,
   * measured natively, unless the style sets one: then that height applies and the parent
   * answers for it.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * The form's look: any of the 28 keys the native themes share. A key left out keeps the native
   * default, including the colors that follow light and dark mode. A key with a value the form
   * cannot use is ignored, with a warning in development. A new theme applies to the form on
   * screen and keeps the card typed into it.
   */
  theme?: PaymentCardFormTheme;
  /**
   * Language of the labels, placeholders and errors, e.g. `'cs'` or `'en'`. Left out, the form
   * follows `GopayConfig.locale`, then the device language, then Czech, as the native SDKs do.
   * Ignored when `localeStrings` is set.
   */
  locale?: string;
  /** The form's strings, all 12 keys. They take precedence over `locale`. */
  localeStrings?: GopayLocaleStrings;
  /**
   * When the form shows its inline errors. `'hidden'`, the native default, when left out. On iOS,
   * set it before the form appears: a mode changed on a form on screen reaches the field display
   * but not what `submitCardForm` and `clearCardFormData` do to the submit flag (the iOS SDK keeps
   * the mode the form appeared with for them; mount the form again to change it).
   */
  validation?: PaymentCardFormValidation;
  /**
   * Whether the system may offer a saved card for the card number and the expiry (iOS autofill,
   * Android autofill services). `false`, the native default, when left out. Never the CVV.
   */
  allowsAutofill?: boolean;
  /**
   * Told whether the card in the form passes its validation: once when the form appears, whenever
   * that flips, and `false` when the form leaves. Nothing else about the card. Meant for enabling
   * the pay button.
   */
  onValidityChange?: (isValid: boolean) => void;
  /**
   * Whether a submit was attempted since the fields were last emptied, the flag by which
   * `'onSubmit'` shows the errors of every invalid field and `'live'` those of every field typed
   * into. Left out, the form keeps the flag itself: `submitCardForm` raises it, emptying the form
   * lowers it. Set, the value given here is the flag, as the native `submitAttempted` is; store what
   * `onSubmitAttemptedChange` reports and pass it back, or the flag stays as you set it: store it in
   * the handler itself, synchronously. The value the SDK reported holds until the component renders
   * after the event, the render your stored value arrives with, so a quick second change (a failed
   * submit and `clearCardFormData` right after it) is not lost.
   *
   * The platforms differ, as the native SDKs do: on iOS set it before the form appears (as
   * `validation`), and when you stop setting it the iOS form goes back to its own flag as it was
   * before, while the Android form keeps the last value. On Android below native SDK 3.2.0, a
   * `submitCardForm` that fails at once followed by `clearCardFormData` in the same frame may leave
   * the flag `true`: lower it yourself after such a clear. See the README.
   */
  submitAttempted?: boolean;
  /**
   * Told when the SDK changes the flag of a form whose `submitAttempted` you set: `true` when
   * `GopaySDK.submitCardForm` is called for it (on iOS only in `'live'` and `'onSubmit'`, on
   * Android in `'hidden'` too), `false` when the form empties its fields (after a successful
   * submit, `clearCardFormData` or as the mounted form leaves the window). Passing the value back
   * does not tell it again. Not told while you leave `submitAttempted` out, nor when the component
   * unmounts: lower your flag yourself then.
   */
  onSubmitAttemptedChange?: (attempted: boolean) => void;
}

/** The native view's props: the public ones, under the same names, and the events it reports. */
interface NativePaymentCardFormProps {
  formId: string;
  style: StyleProp<ViewStyle>;
  theme?: PaymentCardFormTheme;
  locale?: string;
  localeStrings?: GopayLocaleStrings;
  validation?: PaymentCardFormValidation;
  allowsAutofill?: boolean;
  submitAttempted?: boolean;
  /**
   * Not public: the number of the last `onFormSubmitAttemptedChange` JS has answered. Until it
   * arrives, the native view gives the SDK the value it reported instead of `submitAttempted`.
   */
  submitAttemptedAck?: number;
  /** Not public: the height the native form needs at the width it was given, in points. */
  onFormHeightChange: (event: NativeSyntheticEvent<{ height: number }>) => void;
  /** Not public: the form's validity, only when it changes. */
  onFormValidityChange: (event: NativeSyntheticEvent<{ isValid: boolean }>) => void;
  /**
   * Not public: the SDK changing the submit flag, only while JS sets `submitAttempted`, with the
   * number JS answers through `submitAttemptedAck`.
   */
  onFormSubmitAttemptedChange: (
    event: NativeSyntheticEvent<{ attempted: boolean; seq: number }>
  ) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

/** The view `View(...)` registers in the native module `GopayReactNativeSDK`. */
const NativePaymentCardForm: ComponentType<NativePaymentCardFormProps> =
  requireNativeView(NATIVE_MODULE_NAME);

/** Development only: a `formId` from untyped JS that is not a string, told once per app run. */
function checkFormId(formId: unknown) {
  if (typeof formId === 'string') return;
  warnOnce(
    `PaymentCardForm needs a formId string, got ${typeof formId}: the same id goes to ` +
      'GopaySDK.submitCardForm.'
  );
}

/** A prop from untyped JS that is not of its type is left out, with a warning in development. */
function ofType<T extends string | boolean>(
  name: string,
  value: unknown,
  type: T extends string ? 'string' : 'boolean'
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === type) return value as T;
  warnOnce(`PaymentCardForm ${name} must be a ${type}, got ${typeof value}: it is ignored.`);
  return undefined;
}

/**
 * The same object for the same content, so that a theme or strings written inline do not cross
 * the bridge again on every render, and their warnings are not checked again either. A value JSON
 * cannot write (a cycle, a BigInt) is checked anew on every render instead of being taken for an
 * earlier one.
 */
function useStable<T>(value: unknown, sanitize: (value: unknown) => T): T {
  let key: string | null;
  try {
    key = JSON.stringify(value) ?? 'undefined';
  } catch {
    key = null;
  }
  const memoized = useMemo(() => (key === null ? undefined : sanitize(value)), [key]);
  return key === null ? sanitize(value) : (memoized as T);
}

/**
 * The card form of the native GoPay SDK, `PaymentCardForm` on iOS (SwiftUI) and Android (Compose),
 * hosted as it is. What the user types stays native: JS submits the form by its `formId` and
 * receives only the JWE (`GopaySDK.submitCardForm`).
 *
 * Unmounting the form drops the card. On Android the form keeps the app's window out of
 * screenshots (`FLAG_SECURE`) while it is mounted, except in a debuggable build.
 */
export function PaymentCardForm({
  formId,
  style,
  theme,
  locale,
  localeStrings,
  validation,
  allowsAutofill,
  onValidityChange,
  submitAttempted,
  onSubmitAttemptedChange,
}: PaymentCardFormProps) {
  const [measuredHeight, setMeasuredHeight] = useState<number>();
  const onFormHeightChange = useCallback(
    (event: NativeSyntheticEvent<{ height: number }>) =>
      setMeasuredHeight(event.nativeEvent.height),
    []
  );

  // Development only: a form its parent gives no width (under `alignItems: 'center'`, in a row
  // without a width) measures no height and stays invisible. Told once per form, from the layout
  // event rather than an effect, so Strict Mode does not tell it twice.
  const warnedAboutWidth = useRef(false);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (event.nativeEvent.layout.width > 0 || warnedAboutWidth.current) return;
      warnedAboutWidth.current = true;
      console.warn(
        `PaymentCardForm "${formId}" has no width. Its parent must give it one, e.g. with ` +
          "alignSelf: 'stretch' or a width in style; until then the form has no height either."
      );
    },
    [formId]
  );
  checkFormId(formId);

  const onFormValidityChange = useCallback(
    (event: NativeSyntheticEvent<{ isValid: boolean }>) =>
      onValidityChange?.(event.nativeEvent.isValid === true),
    [onValidityChange]
  );
  // Tells the app, and answers the native view with the event's number in the same render as the
  // app's answer, whether or not the app stores the value. Until then the native view holds the
  // value it reported; from then on `submitAttempted` is the flag again. Neither raises an event.
  const [submitAttemptedAck, setSubmitAttemptedAck] = useState<number>();
  const onFormSubmitAttemptedChange = useCallback(
    (event: NativeSyntheticEvent<{ attempted: boolean; seq: number }>) => {
      setSubmitAttemptedAck(event.nativeEvent.seq);
      onSubmitAttemptedChange?.(event.nativeEvent.attempted === true);
    },
    [onSubmitAttemptedChange]
  );

  const cleanTheme = useStable(theme, sanitizeTheme);
  const cleanLocaleStrings = useStable(localeStrings, sanitizeLocaleStrings);
  // A prop left out is not passed at all, so that the native form keeps its own default.
  const optional: Partial<NativePaymentCardFormProps> = {};
  if (cleanTheme !== undefined) optional.theme = cleanTheme;
  const cleanLocale = ofType<string>('locale', locale, 'string');
  if (cleanLocale !== undefined) optional.locale = cleanLocale;
  if (cleanLocaleStrings !== undefined) optional.localeStrings = cleanLocaleStrings;
  const cleanValidation = sanitizeValidation(validation);
  if (cleanValidation !== undefined) optional.validation = cleanValidation;
  const cleanAutofill = ofType<boolean>('allowsAutofill', allowsAutofill, 'boolean');
  if (cleanAutofill !== undefined) optional.allowsAutofill = cleanAutofill;
  const cleanSubmitAttempted = ofType<boolean>('submitAttempted', submitAttempted, 'boolean');
  if (cleanSubmitAttempted !== undefined) {
    optional.submitAttempted = cleanSubmitAttempted;
    if (submitAttemptedAck !== undefined) optional.submitAttemptedAck = submitAttemptedAck;
  }

  return (
    // No `key={formId}` on purpose: the native SDK moves the form and its card to a new formId
    // itself, while a key would remount the form and drop the card.
    // No key that follows the other props either: a new theme, locale or validation applies to
    // the form on screen and keeps its card.
    <NativePaymentCardForm
      {...optional}
      formId={formId}
      onFormHeightChange={onFormHeightChange}
      onFormValidityChange={onFormValidityChange}
      onFormSubmitAttemptedChange={onFormSubmitAttemptedChange}
      onLayout={__DEV__ ? onLayout : undefined}
      // The integrator's style last, so that a height in it wins over the measured one.
      style={[{ height: measuredHeight }, style]}
    />
  );
}
