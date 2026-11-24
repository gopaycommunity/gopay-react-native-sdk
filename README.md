# GoPay React Native SDK (`@gopaycz/gopay-react-native-sdk`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React Native SDK for charging GoPay payments from a mobile app, for the GoPay Payments 4.0 API:
[API documentation](https://api-docs.gopay.com/en/api),
[OpenAPI specification](https://api-docs.gopay.com/spec/en/payments.yaml).

## Status

**In development, not released yet.** The package is an [Expo module](https://docs.expo.dev/modules/overview/)
that wraps the native [iOS SDK](https://github.com/gopaycommunity/gopay-ios-sdk) and
[Android SDK](https://github.com/gopaycommunity/gopay-android-sdk) (both 3.1.1). So far it configures the SDK and
runs payment sessions: reading the payment, its outcome, the charge and the QR payment details. Charging, the card
form and wallets come next.

---

## Requirements

- **Expo SDK 58** (recommended) or **57** (minimum), New Architecture only.
- A [development build](https://docs.expo.dev/develop/development-builds/introduction/). The package has native
  code, so it does not run in Expo Go.
- **iOS** 16.4 or later. The native SDK comes through Swift Package Manager, which CocoaPods resolves during
  `pod install`; `use_frameworks!` is not required.
- **Android** 7.0 (API 24) or later. The native SDK comes from Maven Central (`cz.gopay:sdk`).

---

## Usage

The API follows the native SDKs: the same names and shapes, with milliseconds for times and a `Promise` for
everything asynchronous.

```ts
import { GopayError, GopaySDK } from '@gopaycz/gopay-react-native-sdk';

GopaySDK.initialize({ environment: 'sandbox', clientId, shareableKey });

const session = await GopaySDK.startPaymentSession({ paymentId, paymentSecret });
try {
  const { outcome } = await session.getPaymentOutcome();
} catch (error) {
  if (error instanceof GopayError) console.warn(error.code, error.httpStatus);
}
await session.close();
```

- **`GopaySDK`**: `version`, `chargeReturnUrl`, `initialize(config)`,
  `startPaymentSession({ paymentId, paymentSecret, scope? })`, `getPaymentSession(paymentId)` (a handle or
  `null`) and `closeAllPaymentSessions()`.
- **`GopayConfig`**: `environment` (`'production'`, `'sandbox'` or `{ development: baseUrl }`), `clientId`,
  `shareableKey`, `debugLoggingEnabled`, `locale` and `requestTimeoutMs`, which is 30000 by default on both
  platforms (the native default is 60 s on iOS).
- **`PaymentSession`**: `paymentId`, `getStatus()`, `getPaymentOutcome()`, `getChargeState()`,
  `getQrPaymentInfo(format?)` and `close()`. In JS a session is a handle on the native session of its
  `paymentId`, and several handles may share one session (see below). A call on a closed handle, or on a session
  the native SDK no longer has, fails with `AUTH_013`.
- **Models** (`PaymentDetails`, `PaymentOutcome`, `ChargePaymentResponse`, `QrPaymentDetails`, …) have the
  property names of the native types. Enums are string literals with the gateway's values, `'UNKNOWN'` included
  where the native SDKs map a value they do not know to it. `PaymentDetails` has no `paymentSecret`: no secret
  comes back to JS.

### Starting the same payment twice

Unlike the native SDKs, `startPaymentSession` for a payment that has a session already resolves with a handle on
that session instead of failing with `AUTH_012`. A reload or React Strict Mode, which runs effects twice in
development, then needs no special care. JS asks the native SDK first, so such a start sends nothing and its
`paymentSecret` goes nowhere: the session keeps the credentials it started with. The secret reaches the gateway a
second time in two cases only. When two starts of the same payment run at the same time, the second one sends its
secret before the native SDK answers `AUTH_012`; it then resolves with a handle too, unless the gateway refuses
that secret. And when `closeAllPaymentSessions` overlaps a start, it may have closed the session the start opened,
so the start asks again and starts natively once more with its secret. Every other error of the start is thrown as
it is.

### Closing handles

Every handle from `startPaymentSession` or `getPaymentSession` is closed on its own: `close()` closes that handle
for good, and the native session closes with the last open handle on it. An effect's cleanup may therefore always
call `close()`:

```ts
useEffect(() => {
  let session: PaymentSession | undefined;
  let closed = false;
  const close = (handle: PaymentSession) =>
    handle.close().catch((error) => console.warn('Closing the payment session failed', error));
  GopaySDK.startPaymentSession({ paymentId, paymentSecret })
    .then((started) => {
      session = started;
      if (closed) close(started);
      else setSession(started);
    })
    .catch((error) => {
      if (!closed) setStartError(error); // a GopayError, for example AUTH_010
    });
  return () => {
    closed = true;
    if (session) close(session);
  };
}, [paymentId, paymentSecret]);
```

In Strict Mode the first run's handle closes, and the second run's handle keeps the session. A closed handle
answers `AUTH_013`, also after a new session of the same payment starts, and closing it again does nothing.
`closeAllPaymentSessions()` closes every handle. After a reload JS no longer knows the handles it gave out; the
native session stays, and the next start or `getPaymentSession` finds it.

### Errors

Every failure of the SDK is thrown as a `GopayError` with the shared `code` of the native SDKs (`GopayErrorCode`,
the codes of `ERROR_CODES.md` in the native repositories), the `message`, and when they apply `httpStatus`,
`chargeState` and `gatewayError`. The bridge sends native errors to JS as data, since a rejected Expo promise
carries only a code and a message. An unexpected failure of the bridge itself is a plain `Error` (an Expo error
whose `code` starts with `ERR_`), never a `GopayError`.

`initialize` on Android throws `CONFIG_006` at once for a development base URL the HTTP client refuses; on iOS the
first request fails with it.

Before `initialize`, both platforms answer alike: `getPaymentSession` returns `null`, `closeAllPaymentSessions`
and `close()` do nothing, a call on a session fails with `AUTH_013` and `startPaymentSession` with `CONFIG_001`.
(The Android SDK itself would throw `CONFIG_001` for all of them; the bridge answers as the iOS SDK does.)

On Android, `initialize` hands the SDK the current Activity when there is one, otherwise the application Context;
the SDK then learns the screen in front at its next `onResume`.

---

## Running the example app

The example app in `example/` uses the package straight from the repository root. Its `ios/` and `android/`
folders are generated by `expo prebuild` and are not checked in.

```bash
npm install
cd example
npm install
npx expo prebuild --clean
```

Then run it on a simulator or an emulator:

```bash
npx expo run:ios
npx expo run:android
```

The app is a screen for checking the bridge by hand: the native SDK version, fields for `paymentId` and
`paymentSecret`, a button for each call and its result or `GopayError` as JSON. For calls that need the merchant's
keys, copy `example/.env.example` to `example/.env.local` (ignored by git) and fill in sandbox keys.

For the session handles it also has a checkout that starts the session in an effect as shown above, mounted inside
`<StrictMode>` with a numbered log of every effect run (`mount checkout (Strict Mode)`, `unmount checkout`,
`checkout: getStatus`); `two starts at once` and `close both` for two concurrent starts of one payment; and
`initialize (other connection)`, which changes only the request timeout, so the native SDK closes every session and
the handles answer `AUTH_013`. Strict Mode runs effects twice only in a development (Debug) build; in a Release
build the checkout runs its effect once.

If CocoaPods fails during prebuild, run it with `LANG=en_US.UTF-8`.

The package's TypeScript compiles to `build/` on `npm install`. After changing `src/`, run `npm run build` in the
repository root (or `npx tsc --watch`) so that Metro picks up the change.

---

## Development

```bash
npm run lint
npm run typecheck
npm test
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with a Jira reference,
for example `feat: expose the native SDK version GPMOB-162`. A commit hook checks them.

## License

[MIT](LICENSE)
