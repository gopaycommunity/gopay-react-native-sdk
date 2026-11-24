import { GopayError, GopaySDK, type PaymentSession } from '@gopaycz/gopay-react-native-sdk';
import { useEffect } from 'react';
import { Text } from 'react-native';

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
