import {
  GopayError,
  GopaySDK,
  PaymentCardForm,
  type PaymentCardFormTheme,
  type PaymentCardFormValidation,
  type PaymentSession,
} from '@gopaycz/gopay-react-native-sdk';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CardCharge } from './CardCharge';
import { describeError, describeJwe } from './describe';

/** The form's id, the same for the component and the three calls. */
const CARD_FORM_ID = 'checkout';

/** Numbers the effect runs across mounts, so that the log tells the Strict Mode runs apart. */
let effectRuns = 0;

/**
 * A checkout screen that starts the payment session in an effect, as the README shows. The App
 * mounts it inside <StrictMode>, which runs the effect twice in a development build. Every step
 * goes to `log`, numbered by the effect run; the secret never does.
 */
export function Checkout(props: {
  paymentId: string;
  paymentSecret: string;
  log: (line: string) => void;
  onHandle: (handle: PaymentSession | null) => void;
}) {
  const { paymentId, paymentSecret, log, onHandle } = props;

  useEffect(() => {
    const run = ++effectRuns;
    let session: PaymentSession | undefined;
    let closed = false;
    const close = (handle: PaymentSession) =>
      handle
        .close()
        .then(() => log(`run ${run}: closed`))
        .catch((error) => log(`run ${run}: close failed: ${describeError(error)}`));

    log(`run ${run}: start`);
    GopaySDK.startPaymentSession({ paymentId, paymentSecret })
      .then((started) => {
        session = started;
        if (closed) {
          log(`run ${run}: resolved after cleanup, closing`);
          close(started);
        } else {
          log(`run ${run}: handle`);
          onHandle(started);
        }
      })
      .catch((error) => {
        log(`run ${run}: start failed: ${describeError(error)}`);
      });

    return () => {
      closed = true;
      log(`run ${run}: cleanup${session ? ', closing' : ''}`);
      if (session) {
        onHandle(null);
        close(session);
      }
    };
  }, [paymentId, paymentSecret, log, onHandle]);

  return <Text style={{ fontSize: 12, marginTop: 8 }}>Checkout mounted for {paymentId}</Text>;
}

/**
 * A theme with all 28 keys, far enough from the defaults that each key shows: compare iOS and
 * Android side by side. The font is a system one of each platform, so nothing has to be bundled.
 */
const CUSTOM_THEME: Required<PaymentCardFormTheme> = {
  fontFamily: Platform.select({ ios: 'Menlo-Regular', default: 'monospace' }),
  labelColor: '#6A1B9A',
  labelFontSize: 13,
  labelFontWeight: 700,
  labelLineHeight: 20,
  labelUppercase: true,
  labelLetterSpacing: 1.5,
  labelHidden: false,
  inputTextColor: '#0D47A1',
  inputFontSize: 18,
  inputFontWeight: 500,
  inputHeight: 52,
  placeholderColor: '#0D47A180',
  inputBorderColor: '#6A1B9A',
  inputBorderWidth: 2,
  inputBackgroundColor: '#F3E5F5',
  inputPaddingVertical: 8,
  inputPaddingHorizontal: 14,
  inputBorderRadius: 12,
  inputErrorBorderColor: '#E65100',
  errorTextColor: '#E65100',
  errorFontSize: 13,
  errorMinHeight: 18,
  errorSpacing: 6,
  groupSpacing: 20,
  fieldSpacing: 8,
  formPadding: 12,
  formBackgroundColor: '#FFF8E1',
};

/** The values each switch goes through; `undefined` is the prop left out. */
// 'xx' is the custom locale of the App's "initialize (customLocales xx)".
const LOCALES = [undefined, 'cs', 'en', 'de', 'sk', 'xx'] as const;
const VALIDATIONS: (PaymentCardFormValidation | undefined)[] = [
  undefined,
  'hidden',
  'live',
  'onSubmit',
];

const next = <T,>(values: readonly T[], value: T) =>
  values[(values.indexOf(value) + 1) % values.length]!;

const show = (value: unknown) => (value === undefined ? 'left out' : String(value));

/**
 * The SDK's card form with the three calls on it, a switch that unmounts and mounts it again and
 * switches for its props, to check them on a device. The card is typed by hand into the form;
 * nothing in JS writes into it or reads it, and changing a prop must keep it. The JWE is never
 * shown, only its length and parts; the card's metadata is shown as JSON.
 */
export function CardFormCheckout(props: {
  output: (text: string) => void;
  session: PaymentSession | null;
}) {
  const { output, session } = props;
  const [mounted, setMounted] = useState(true);
  const [customTheme, setCustomTheme] = useState(false);
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>(undefined);
  const [validation, setValidation] = useState<PaymentCardFormValidation | undefined>(undefined);
  const [allowsAutofill, setAllowsAutofill] = useState<boolean | undefined>(undefined);
  // Driven by the app, or left out so that the form keeps the flag itself.
  const [controlled, setControlled] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // The booleans the form reports, the only things besides its height that leave it.
  const [isValid, setIsValid] = useState<boolean>();
  const [events, setEvents] = useState<string[]>([]);
  const logEvent = (line: string) => setEvents((lines) => [line, ...lines].slice(0, 6));

  const run = (label: string, call: () => Promise<string> | string) => async () => {
    output(`${label}…`);
    try {
      output(`${label}: OK\n${await call()}`);
    } catch (error) {
      output(
        `${label}: ${error instanceof GopayError ? 'GopayError' : 'error'}\n${describeError(error)}`
      );
    }
  };

  const buttons: [string, () => Promise<void>][] = [
    [
      'submitCardForm',
      run('submitCardForm', async () => describeJwe(await GopaySDK.submitCardForm(CARD_FORM_ID))),
    ],
    [
      'submitCardFormWithMetadata',
      run('submitCardFormWithMetadata', async () => {
        const { encryptedPayload, cardMetadata } =
          await GopaySDK.submitCardFormWithMetadata(CARD_FORM_ID);
        return `${describeJwe(encryptedPayload)}\ncardMetadata: ${JSON.stringify(cardMetadata ?? null, null, 2)}`;
      }),
    ],
    [
      'clearCardFormData',
      run('clearCardFormData', () => {
        GopaySDK.clearCardFormData(CARD_FORM_ID);
        return 'cleared';
      }),
    ],
    [
      mounted ? 'unmount form' : 'mount form',
      run(mounted ? 'unmount form' : 'mount form', () => {
        setMounted(!mounted);
        return mounted ? 'unmounted' : 'mounted';
      }),
    ],
  ];

  const switches: [string, string, () => void][] = [
    ['theme', customTheme ? 'custom' : 'default', () => setCustomTheme(!customTheme)],
    ['locale', show(locale), () => setLocale(next(LOCALES, locale))],
    ['validation', show(validation), () => setValidation(next(VALIDATIONS, validation))],
    [
      'allowsAutofill',
      show(allowsAutofill),
      () => setAllowsAutofill(next([undefined, true, false], allowsAutofill)),
    ],
    [
      'submitAttempted',
      controlled ? `driven: ${submitAttempted}` : 'left out',
      () => setControlled(!controlled),
    ],
  ];
  if (controlled) {
    switches.push([
      'set submitAttempted',
      String(!submitAttempted),
      () => setSubmitAttempted(!submitAttempted),
    ]);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Card form “{CARD_FORM_ID}”</Text>
      {mounted ? (
        <PaymentCardForm
          formId={CARD_FORM_ID}
          style={styles.form}
          theme={customTheme ? CUSTOM_THEME : undefined}
          locale={locale}
          validation={validation}
          allowsAutofill={allowsAutofill}
          onValidityChange={(valid) => {
            setIsValid(valid);
            logEvent(`onValidityChange(${valid})`);
          }}
          submitAttempted={controlled ? submitAttempted : undefined}
          onSubmitAttemptedChange={(attempted) => {
            // Stored and passed back, as a driven flag must be; passing it back raises no event.
            setSubmitAttempted(attempted);
            logEvent(`onSubmitAttemptedChange(${attempted})`);
          }}
        />
      ) : (
        <Text style={styles.small}>form unmounted</Text>
      )}
      <Text testID="card-form-state" style={styles.small}>
        valid: {show(isValid)} · events: {events.join(', ') || 'none'}
      </Text>
      <View style={styles.buttons}>
        {switches.map(([title, value, onPress]) => (
          <Pressable
            key={title}
            testID={title}
            style={[styles.button, styles.switch]}
            onPress={onPress}>
            <Text style={styles.buttonText}>
              {title}: {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.buttons}>
        {buttons.map(([title, onPress]) => (
          <Pressable key={title} testID={title} style={styles.button} onPress={onPress}>
            <Text style={styles.buttonText}>{title}</Text>
          </Pressable>
        ))}
      </View>
      <CardCharge formId={CARD_FORM_ID} session={session} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#ddd', paddingTop: 8 },
  title: { fontSize: 14, fontWeight: '600' },
  // The form's height is its own; the border shows that nothing is cut off.
  form: { borderWidth: 1, borderColor: '#f0a', marginTop: 8 },
  small: { fontSize: 12, color: '#555', marginTop: 4 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  button: {
    backgroundColor: '#0a7d32',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  switch: { backgroundColor: '#37474f' },
  buttonText: { color: '#fff', fontSize: 12 },
});
