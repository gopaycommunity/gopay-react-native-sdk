import {
  GopayError,
  GopaySDK,
  type ChallengePreference,
  type ChargePaymentResponse,
  type PaymentSession,
  type ThreeDSMode,
} from '@gopaycz/gopay-react-native-sdk';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

// A tool for checking the card charge through the bridge by hand, not a demo. Neither the JWE nor
// the card token is ever shown: the JWE only by its length and parts, the token only as "given"
// or "empty".

/** The lines of `errorCallback`, which the App's config passes to `initialize`. */
const errorCallbackListeners = new Set<(line: string) => void>();

/** The `errorCallback` of the example's config: every error goes to the charge log. */
export function logErrorCallback(error: GopayError): void {
  const line = `errorCallback: ${describeError(error)}`;
  for (const listener of errorCallbackListeners) listener(line);
}

const PREFERENCES: (ChallengePreference | undefined)[] = [
  undefined,
  'AUTO',
  'CHALLENGE_PREFERRED',
  'NO_CHALLENGE_PREFERRED',
];

/** A charge in one line: its state, why it failed and what action it asks for. */
const describeCharge = (charge: ChargePaymentResponse) =>
  [
    charge.state,
    charge.failReason && `failReason ${charge.failReason}`,
    charge.action &&
      `action ${charge.action.actionType} ${charge.action.state ?? ''} ${charge.action.redirectUrl ? 'with redirectUrl' : ''}`,
  ]
    .filter(Boolean)
    .join(', ');

/** A thrown value: a GopayError with every field, anything else with its name and message. */
function describeError(error: unknown): string {
  if (error instanceof GopayError) {
    const { code, message, httpStatus, chargeState, gatewayError } = error;
    return `GopayError ${JSON.stringify({ code, message, httpStatus, chargeState, gatewayError })}`;
  }
  return `${(error as Error)?.name ?? 'error'} ${(error as Error)?.message ?? String(error)}`;
}

const describeJwe = (jwe: string) => `JWE ${jwe.length} characters, ${jwe.split('.').length} parts`;

export function CardCharge(props: { formId: string; session: PaymentSession | null }) {
  const { formId, session } = props;
  const [preference, setPreference] = useState<ChallengePreference | undefined>(undefined);
  const [mode, setMode] = useState<ThreeDSMode>('automatic');
  const [returnUrl, setReturnUrl] = useState('');
  const [cardToken, setCardToken] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((lines) => [...lines, line]);

  useEffect(() => {
    errorCallbackListeners.add(add);
    return () => {
      errorCallbackListeners.delete(add);
    };
  }, []);

  /** `awaitChargeState` with the chosen mode, every callback logged, then `getPaymentOutcome`. */
  const awaitAndOutcome = async (handle: PaymentSession) => {
    add(`awaitChargeState (${mode})…`);
    try {
      const charge = await handle.awaitChargeState({
        threeDSMode: mode,
        returnUrl: returnUrl || undefined,
        onStateChange: (c) => add(`onStateChange: ${describeCharge(c)}`),
        onActionRequired: (url) => add(`onActionRequired: ${url}`),
      });
      add(`awaitChargeState: ${describeCharge(charge)}`);
    } catch (error) {
      add(`awaitChargeState threw: ${describeError(error)}`);
    }
    try {
      const { outcome, payment } = await handle.getPaymentOutcome();
      add(`getPaymentOutcome: ${outcome}, payment ${payment.state}`);
    } catch (error) {
      add(`getPaymentOutcome threw: ${describeError(error)}`);
    }
  };

  const run = (label: string, call: (handle: PaymentSession) => Promise<void>) => async () => {
    if (!session) {
      add(`${label}: no session handle, start or get a session first`);
      return;
    }
    try {
      await call(session);
    } catch (error) {
      add(`${label} threw: ${describeError(error)}`);
    }
  };

  const options = { challengePreference: preference };
  const buttons: [string, () => void][] = [
    [
      'pay with the card from the form',
      run('pay with form', async (handle) => {
        const jwe = await GopaySDK.submitCardForm(formId);
        add(`submitCardForm: ${describeJwe(jwe)}`);
        const charge = await handle.chargeWithEncryptedCard(jwe, options);
        add(`chargeWithEncryptedCard: ${describeCharge(charge)}`);
        await awaitAndOutcome(handle);
      }),
    ],
    [
      'pay with the card token',
      run('pay with token', async (handle) => {
        add(`card token ${cardToken ? 'given' : 'empty'}`);
        const charge = await handle.chargeWithCardToken(cardToken, options);
        add(`chargeWithCardToken: ${describeCharge(charge)}`);
        await awaitAndOutcome(handle);
      }),
    ],
    ['awaitChargeState only', run('await', awaitAndOutcome)],
    [
      `challengePreference: ${preference ?? 'none'}`,
      () => setPreference(PREFERENCES[(PREFERENCES.indexOf(preference) + 1) % PREFERENCES.length]),
    ],
    [
      `threeDSMode: ${mode}`,
      () => setMode((current) => (current === 'automatic' ? 'manual' : 'automatic')),
    ],
    ['clear charge log', () => setLog([])],
  ];

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Card charge (session {session ? session.paymentId : 'none'})</Text>
      <TextInput
        testID="card-token"
        style={styles.input}
        placeholder="card token"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={cardToken}
        onChangeText={setCardToken}
      />
      <TextInput
        testID="return-url"
        style={styles.input}
        placeholder="returnUrl (empty: chargeReturnUrl)"
        autoCapitalize="none"
        autoCorrect={false}
        value={returnUrl}
        onChangeText={setReturnUrl}
      />
      <View style={styles.buttons}>
        {buttons.map(([title, onPress]) => (
          <Pressable key={title} testID={title} style={styles.button} onPress={onPress}>
            <Text style={styles.buttonText}>{title}</Text>
          </Pressable>
        ))}
      </View>
      <Text testID="charge-log" selectable style={styles.output}>
        {log.length ? log.join('\n') : 'charge log: empty'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#ddd', paddingTop: 8 },
  title: { fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, marginTop: 8 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  button: {
    backgroundColor: '#a35200',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  buttonText: { color: '#fff', fontSize: 12 },
  output: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    marginTop: 8,
  },
});
