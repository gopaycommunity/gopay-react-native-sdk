# GoPay React Native SDK (`@gopaycz/gopay-react-native-sdk`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React Native SDK for charging GoPay payments from a mobile app, for the GoPay Payments 4.0 API:
[API documentation](https://api-docs.gopay.com/en/api),
[OpenAPI specification](https://api-docs.gopay.com/spec/en/payments.yaml).

## Status

**In development, not released yet.** The package is an [Expo module](https://docs.expo.dev/modules/overview/)
that wraps the native [iOS SDK](https://github.com/gopaycommunity/gopay-ios-sdk) and
[Android SDK](https://github.com/gopaycommunity/gopay-android-sdk) (both 3.1.1). So far it configures the SDK, runs
payment sessions (reading the payment, its outcome, the charge and the QR payment details) and hosts the native card
form, which turns the card into a JWE. Its theme and other props, charging and wallets come next.

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

### Card form

`PaymentCardForm` shows the card form of the native SDK, `PaymentCardForm` of the iOS SDK (SwiftUI) and of the
Android SDK (Compose), as it is: its fields, validation and look are the native ones. The card the user types stays
in the native SDK; JS submits the form by its `formId` and receives only the JWE, which the merchant's backend
turns into a card token or charges.

```tsx
import { GopaySDK, PaymentCardForm } from '@gopaycz/gopay-react-native-sdk';

<PaymentCardForm formId="checkout" style={{ marginHorizontal: 16 }} />;

const jwe = await GopaySDK.submitCardForm('checkout');
```

- **`PaymentCardForm`** takes `formId` and `style`. `formId` is required here and in the three calls, unlike in
  the native SDKs, where a missing id means the form that was active last: a deliberate narrowing. Keep one form
  on screen per `formId`: a second form under the same id takes it over, and what the user types into the first
  one goes nowhere.
- **`GopaySDK.submitCardForm(formId)`** resolves with the JWE. Send it to your backend promptly and use it for a
  single payment: the gateway accepts each JWE once and within 10 minutes of its creation. Do not log it. On
  success the SDK drops the card and empties the form; a failure leaves the card as the user typed it.
- **`GopaySDK.submitCardFormWithMetadata(formId)`** resolves with `{ encryptedPayload, cardMetadata? }`, the JWE and
  what the gateway knows about the card (`scheme`, `corporate`, `brand`, `serviceType`, `issuer`,
  `issuerCountry`). It can take up to 3 seconds longer; `cardMetadata` is missing when the gateway knows nothing
  about the card or does not answer in time, and the JWE comes all the same.
- **`GopaySDK.clearCardFormData(formId)`** drops the card and empties the form, for when the user abandons the
  checkout while the form stays on screen. It never throws.
- **Errors:** `VALIDATION_008` when no form is on screen under `formId` or its fields are empty, `VALIDATION_007`
  when the card is invalid, `CONFIG_001` before `initialize`.

Call `initialize` before you show the form. The form shows before it too, but `clearCardFormData` then differs
between the platforms, as the native SDKs do: iOS empties the form, Android does nothing and the form keeps what the
user typed.

**Width and height.** The parent must give the form its width: the form has no width of its own. In a column with
the default `alignItems: 'stretch'` it gets the column's width; under `alignItems: 'center'` or in a row, give it
one, or it stays invisible (in development the component warns once):

```tsx
<View style={{ alignItems: 'center' }}>
  <PaymentCardForm formId="checkout" style={{ alignSelf: 'stretch' }} />
</View>
<View style={{ flexDirection: 'row' }}>
  <PaymentCardForm formId="checkout" style={{ flex: 1 }} />
</View>
```

The form measures the height it needs at that width and takes it, also after a rotation or a change of the text
size. A `height` in `style`, also inside an array of styles, wins over the measured one, and then the layout is
yours: a form taller than that is cut off below.

**Unmounting** the component drops the card, natively. Navigating away, a reload of the JS bundle and a remount
after Fast Refresh leave an empty form; a Fast Refresh that keeps the component, and the app going to the
background and back, keep the card. A virtualized list (`FlatList`, `SectionList`) unmounts rows that scroll out
of view and so drops the card, and so does `removeClippedSubviews` on both platforms, which detaches views out of
view: keep the form outside them.

**Screenshots on Android.** While the form is mounted, the Android SDK sets `FLAG_SECURE` on the window it is in,
which in React Native is the window of the whole app: no screenshots or screen recordings of any screen while the
form is mounted. The flag comes off when the form unmounts, unless the window had it before. In a debuggable build
the SDK does not set it, so screenshots keep working during development. On iOS the form covers itself in the app
switcher and while the screen is recorded.

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

The card form section shows `PaymentCardForm` with the id `checkout` (in `<StrictMode>` too), buttons for
`submitCardForm`, `submitCardFormWithMetadata` and `clearCardFormData`, and one that unmounts and mounts the form
again. Type the card into the form by hand; the result shows only the length of the JWE and how many parts it has,
never the JWE itself. A successful submit needs the merchant's keys in `example/.env.local`.

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
