import {
  GopayError,
  GopaySDK,
  type GopayConfig,
  type PaymentSession,
} from '@gopaycz/gopay-react-native-sdk';
import { requireNativeModule } from 'expo';
import { StrictMode, useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Checkout } from './Checkout';

// A tool for checking the bridge by hand, not a demo. The merchant's keys come from
// example/.env.local (see .env.example), which git ignores; the repository holds none.
const config: GopayConfig = {
  environment: 'sandbox',
  clientId: process.env.EXPO_PUBLIC_GOPAY_CLIENT_ID || undefined,
  shareableKey: process.env.EXPO_PUBLIC_GOPAY_SHAREABLE_KEY || undefined,
  debugLoggingEnabled: true,
};

/** The native module as it is, to show the raw envelope of a call on a session that does not exist. */
const nativeModule = requireNativeModule<{
  sessionGetStatus(paymentId: string): Promise<unknown>;
}>('GopayReactNativeSDK');

/** A thrown value as JSON: a GopayError with every field, anything else with its name and message. */
function describeError(error: unknown): string {
  if (error instanceof GopayError) {
    const { name, code, message, httpStatus, chargeState, gatewayError } = error;
    return JSON.stringify({ name, code, message, httpStatus, chargeState, gatewayError }, null, 2);
  }
  if (error instanceof Error) {
    return JSON.stringify({ ...error, name: error.name, message: error.message }, null, 2);
  }
  return String(error);
}

export default function App() {
  const [paymentId, setPaymentId] = useState('');
  const [paymentSecret, setPaymentSecret] = useState('');
  const [session, setSession] = useState<PaymentSession | null>(null);
  const [output, setOutput] = useState('');
  // The Strict Mode checkout: what it was mounted with, its log and the handle it holds.
  const [checkout, setCheckout] = useState<{ paymentId: string; paymentSecret: string } | null>(
    null
  );
  const [checkoutLog, setCheckoutLog] = useState<string[]>([]);
  const [checkoutHandle, setCheckoutHandle] = useState<PaymentSession | null>(null);
  const logCheckout = useCallback(
    (line: string) => setCheckoutLog((lines) => [...lines, line]),
    []
  );
  // The two handles of `two starts at once`.
  const [pair, setPair] = useState<PaymentSession[]>([]);

  // The output never shows the payment secret: no call returns it, and it is never printed.
  const run = (label: string, call: () => unknown) => async () => {
    setOutput(`${label}…`);
    try {
      const result = await call();
      setOutput(`${label}: OK\n${JSON.stringify(result ?? null, null, 2)}`);
    } catch (error) {
      setOutput(
        `${label}: ${error instanceof GopayError ? 'GopayError' : 'error'}\n${describeError(error)}`
      );
    }
  };

  const withSession = (label: string, call: (session: PaymentSession) => unknown) =>
    run(label, () => {
      if (!session) throw new Error('No session handle yet: start or get a session first.');
      return call(session);
    });

  const buttons: [string, () => Promise<void>][] = [
    ['initialize', run('initialize', () => GopaySDK.initialize(config))],
    [
      'initialize (bad development URL)',
      run('initialize (bad development URL)', () =>
        GopaySDK.initialize({ environment: { development: 'not a url' } })
      ),
    ],
    [
      'startPaymentSession',
      run('startPaymentSession', async () => {
        const started = await GopaySDK.startPaymentSession({ paymentId, paymentSecret });
        setSession(started);
        return { paymentId: started.paymentId };
      }),
    ],
    [
      'getPaymentSession',
      run('getPaymentSession', async () => {
        const found = await GopaySDK.getPaymentSession(paymentId);
        if (found) setSession(found);
        return found && { paymentId: found.paymentId };
      }),
    ],
    [
      'closeAllPaymentSessions',
      run('closeAllPaymentSessions', () => GopaySDK.closeAllPaymentSessions()),
    ],
    ['session.getStatus', withSession('getStatus', (s) => s.getStatus())],
    ['session.getPaymentOutcome', withSession('getPaymentOutcome', (s) => s.getPaymentOutcome())],
    ['session.getChargeState', withSession('getChargeState', (s) => s.getChargeState())],
    ['session.getQrPaymentInfo', withSession('getQrPaymentInfo', (s) => s.getQrPaymentInfo())],
    ['session.close', withSession('close', (s) => s.close())],
    [
      'initialize (other connection)',
      // Another request timeout is another connection: the native SDK closes every session.
      run('initialize (other connection)', () =>
        GopaySDK.initialize({ ...config, requestTimeoutMs: 31_000 })
      ),
    ],
    [
      'mount checkout (Strict Mode)',
      run('mount checkout (Strict Mode)', () => {
        setCheckoutLog([]);
        setCheckout({ paymentId, paymentSecret });
        return { paymentId };
      }),
    ],
    [
      'unmount checkout',
      run('unmount checkout', () => {
        setCheckout(null);
        return null;
      }),
    ],
    [
      'checkout: getStatus',
      run('checkout: getStatus', () => {
        if (!checkoutHandle) throw new Error('The checkout holds no handle.');
        return checkoutHandle.getStatus();
      }),
    ],
    [
      'two starts at once',
      run('two starts at once', async () => {
        const results = await Promise.allSettled([
          GopaySDK.startPaymentSession({ paymentId, paymentSecret }),
          GopaySDK.startPaymentSession({ paymentId, paymentSecret }),
        ]);
        const handles = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        setPair((kept) => [...kept, ...handles]);
        const described = results.map((r) =>
          r.status === 'fulfilled'
            ? { handle: r.value.paymentId }
            : { error: r.reason instanceof GopayError ? r.reason.code : String(r.reason) }
        );
        let getStatus: unknown = 'no handle';
        if (handles[0]) {
          try {
            getStatus = await handles[0].getStatus();
          } catch (error) {
            getStatus = { error: error instanceof GopayError ? error.code : String(error) };
          }
        }
        return { results: described, getStatus };
      }),
    ],
    [
      'close both',
      run('close both', async () => {
        const closing = pair;
        setPair([]);
        const results = await Promise.allSettled(closing.map((handle) => handle.close()));
        return results.map((r) =>
          r.status === 'fulfilled'
            ? 'closed'
            : { error: r.reason instanceof GopayError ? r.reason.code : String(r.reason) }
        );
      }),
    ],
    [
      'native envelope: getStatus without a session',
      run('raw envelope', () => nativeModule.sessionGetStatus(paymentId || 'no-such-payment')),
    ],
  ];

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Native GoPay SDK</Text>
        <Text testID="sdk-version" style={styles.version}>
          {GopaySDK.version}
        </Text>
        <Text style={styles.small}>{GopaySDK.chargeReturnUrl}</Text>
        <Text style={styles.small}>
          sandbox, clientId {config.clientId ? 'set' : 'missing'}, shareableKey{' '}
          {config.shareableKey ? 'set' : 'missing'}
        </Text>

        <TextInput
          testID="payment-id"
          style={styles.input}
          placeholder="paymentId"
          autoCapitalize="none"
          autoCorrect={false}
          value={paymentId}
          onChangeText={setPaymentId}
        />
        <TextInput
          testID="payment-secret"
          style={styles.input}
          placeholder="paymentSecret"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={paymentSecret}
          onChangeText={setPaymentSecret}
        />
        <Text style={styles.small}>Session handle: {session ? session.paymentId : 'none'}</Text>

        <View style={styles.buttons}>
          {buttons.map(([title, onPress]) => (
            <Pressable key={title} testID={title} style={styles.button} onPress={onPress}>
              <Text style={styles.buttonText}>{title}</Text>
            </Pressable>
          ))}
        </View>

        {checkout && (
          <StrictMode>
            <Checkout
              paymentId={checkout.paymentId}
              paymentSecret={checkout.paymentSecret}
              log={logCheckout}
              onHandle={setCheckoutHandle}
            />
          </StrictMode>
        )}
        <Text style={styles.small}>Two starts: {pair.length} handle(s) kept</Text>
        <Text testID="checkout-log" selectable style={styles.output}>
          {checkoutLog.length ? checkoutLog.join('\n') : 'checkout log: empty'}
        </Text>

        <Text testID="output" selectable style={styles.output}>
          {output}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 16, paddingTop: 48 },
  label: { fontSize: 14, color: '#555' },
  version: { fontSize: 28, fontWeight: '600' },
  small: { fontSize: 12, color: '#555', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  button: {
    backgroundColor: '#1f4bff',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  buttonText: { color: '#fff', fontSize: 12 },
  output: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    marginTop: 12,
  },
});
