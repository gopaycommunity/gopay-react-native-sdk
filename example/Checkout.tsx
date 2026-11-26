import {
  GopayError,
  GopaySDK,
  PaymentCardForm,
  type PaymentSession,
} from '@gopaycz/gopay-react-native-sdk';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardCharge } from './CardCharge';

/** The form's id, the same for the component and the three calls. */
const CARD_FORM_ID = 'checkout';

/** Numbers the effect runs across mounts, so that the log tells the Strict Mode runs apart. */
let effectRuns = 0;

const describe = (error: unknown) =>
  error instanceof GopayError
    ? `${error.code} ${error.message}`
    : `${(error as Error)?.name ?? 'error'} ${(error as Error)?.message ?? String(error)}`;

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
        .catch((error) => log(`run ${run}: close failed: ${describe(error)}`));

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
        log(`run ${run}: start failed: ${describe(error)}`);
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

/** A JWE described without showing it: its length and how many dot-separated parts it has. */
const describeJwe = (jwe: string) =>
  `JWE: ${jwe.length} characters, ${jwe.split('.').length} parts`;

/**
 * The SDK's card form with the three calls on it and a switch that unmounts and mounts it again.
 * The card is typed by hand into the form; nothing in JS writes into it or reads it. The JWE is
 * never shown, only its length and parts; the card's metadata is shown as JSON.
 */
export function CardFormCheckout(props: {
  output: (text: string) => void;
  session: PaymentSession | null;
}) {
  const { output, session } = props;
  const [mounted, setMounted] = useState(true);

  const run = (label: string, call: () => Promise<string> | string) => async () => {
    output(`${label}…`);
    try {
      output(`${label}: OK\n${await call()}`);
    } catch (error) {
      output(
        `${label}: ${error instanceof GopayError ? 'GopayError' : 'error'}\n${describe(error)}`
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

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Card form “{CARD_FORM_ID}”</Text>
      {mounted ? (
        <PaymentCardForm formId={CARD_FORM_ID} style={styles.form} />
      ) : (
        <Text style={styles.small}>form unmounted</Text>
      )}
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
  buttonText: { color: '#fff', fontSize: 12 },
});
