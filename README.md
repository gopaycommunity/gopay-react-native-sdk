# GoPay React Native SDK (`@gopaycz/gopay-react-native-sdk`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

React Native SDK for charging GoPay payments from a mobile app, for the GoPay Payments 4.0 API:
[API documentation](https://api-docs.gopay.com/en/api),
[OpenAPI specification](https://api-docs.gopay.com/spec/en/payments.yaml).

## Status

**In development, not released yet.** The package is an [Expo module](https://docs.expo.dev/modules/overview/)
that wraps the native [iOS SDK](https://github.com/gopaycommunity/gopay-ios-sdk) and
[Android SDK](https://github.com/gopaycommunity/gopay-android-sdk) (both 3.1.1). So far it configures the SDK, runs
payment sessions (reading the payment, its outcome, the charge and the QR payment details), hosts the native card
form with its theme, languages and validation, which turns the card into a JWE, and charges a card (a JWE or a card
token) with 3DS. Wallets come next.

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
  `shareableKey`, `debugLoggingEnabled`, `locale`, `customLocales` (the card form's own translations, see
  [Card form props](#card-form-props)), `requestTimeoutMs`, which is 30000 by default on both platforms (the
  native default is 60 s on iOS), and `errorCallback` (see below).
- **`PaymentSession`**: `paymentId`, `getStatus()`, `getPaymentOutcome()`, `chargeWithEncryptedCard(jwe, options?)`,
  `chargeWithCardToken(cardToken, options?)`, `getChargeState()`, `awaitChargeState(options?)`,
  `getQrPaymentInfo(format?)` and `close()`. In JS a session is a handle on the native session of its
  `paymentId`, and several handles may share one session (see below). A call on a closed handle, or on a session
  the native SDK no longer has, fails with `AUTH_013`.
- **`PaymentCardForm`**: `formId`, `style`, `theme`, `locale`, `localeStrings`, `validation`, `allowsAutofill`,
  `onValidityChange`, `submitAttempted` and `onSubmitAttemptedChange` ([Card form](#card-form),
  [Card form props](#card-form-props)); the form is submitted with `GopaySDK.submitCardForm(formId)` or
  `submitCardFormWithMetadata(formId)` and emptied with `clearCardFormData(formId)`.
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

- **`PaymentCardForm`** takes `formId`, `style` and the props in [Card form props](#card-form-props). `formId`
  is required here and in the three calls, unlike in the native SDKs, where a missing id means the form that was
  active last: a deliberate narrowing. Keep one form on screen per `formId`: a second form under the same id takes
  it over, and what the user types into the first one goes nowhere. Changing `formId` on a mounted form moves the
  form and the card the user has typed to the new id.
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

### Card form props

```tsx
<PaymentCardForm
  formId="checkout"
  theme={{ labelColor: '#6A1B9A', inputBorderRadius: 12 }}
  locale="en"
  validation="onSubmit"
  allowsAutofill
  onValidityChange={setPayEnabled}
/>
```

| Prop | Type | Left out |
|---|---|---|
| `theme` | `PaymentCardFormTheme` | the native look |
| `locale` | `string` | `GopayConfig.locale`, then the device language, then Czech |
| `localeStrings` | `GopayLocaleStrings` | the strings of `locale` |
| `validation` | `'hidden' \| 'live' \| 'onSubmit'` | `'hidden'` |
| `allowsAutofill` | `boolean` | `false` |
| `onValidityChange` | `(isValid: boolean) => void` | |
| `submitAttempted` | `boolean` | the form keeps the flag itself |
| `onSubmitAttemptedChange` | `(attempted: boolean) => void` | |

The names, values and defaults are those of the native `PaymentCardForm`. A prop left out is not passed, so the
native default applies: the SDK's default theme, and for `validation` and `allowsAutofill` the bridge's copy of the
SDK's defaults (`'hidden'`, `false`), which the native SDKs give no way to read. A new value of any prop applies to
the form on screen: the card typed into it stays, and the form measures its height again. Out of the form come only
its height, its overall validity and the submit flag, never anything about the card.

**Theme.** `PaymentCardFormTheme` has the 28 keys the iOS and Android themes share, named as there (and after the
GoPay web card form), all optional:

- colors as hex strings, `#RRGGBB` or `#RRGGBBAA` (alpha last): `labelColor`, `inputTextColor`, `placeholderColor`,
  `inputBorderColor`, `inputBackgroundColor`, `inputErrorBorderColor`, `errorTextColor`, `formBackgroundColor`;
- lengths as numbers from 0 to 1000, points on iOS and dp on Android: `inputHeight`, `inputBorderWidth`,
  `inputPaddingVertical`, `inputPaddingHorizontal`, `inputBorderRadius`, `errorMinHeight`, `errorSpacing`,
  `groupSpacing`, `fieldSpacing`, `formPadding`;
- type as numbers, points on iOS and sp on Android: `labelFontSize`, `inputFontSize`, `errorFontSize` above 0 up to
  200, `labelLineHeight` above 0 up to 400, `labelLetterSpacing` from -100 to 100; weights as CSS numbers from 100
  to 900: `labelFontWeight`, `inputFontWeight`;
- `labelUppercase`, `labelHidden` as booleans and `fontFamily` as a font name.

A key left out keeps the native default, including the colors that follow light and dark mode (the system colors
on iOS, the app theme's colors on Android); the bridge fills in nothing. A key with a value the form cannot use (a
color that is not hex, a number outside the ranges above, a key the iOS and Android themes do not share, such as
Android's `helperTextColor`) is ignored, with a warning in development, and the form keeps its default there; the
native views skip such a value too, so the form never fails on a theme. The limits are far above any real form;
they keep a typo from reaching a layout that cannot hold it (Android measures in 32-bit floats). The package exports
them, read-only, as `PAYMENT_CARD_FORM_THEME_LIMITS` (`length`, `fontSize`, `lineHeight`, `letterSpacing`).

The default colors follow dark mode differently, as the native SDKs do. On iOS they change as soon as the system
switches. On Android they come from the app theme's attributes when the form appears, and an Expo app does not
recreate its Activity when dark mode switches (`uiMode` is in its `configChanges`), so a form with the default
colors keeps those of the mode it appeared in until the Activity is recreated (a change of the font size, a restart).
State the colors in `theme` where that matters.

`fontFamily` is looked up differently on the two platforms, as the native SDKs and React Native do. iOS takes the
name of a font face as `UIFont(name:)` knows it, its PostScript or full name (`Inter-Regular`). On iOS neither a
family name (`Inter`) nor the name a font was loaded under with `expo-font` (the key in `useFonts`) is found, unless
it is that PostScript name, although both work in a React Native `fontFamily` style. Android takes the name React
Native knows for `fontFamily` in a style: the name a font was loaded under with `expo-font`, or the name of a file
in `assets/fonts`. Android also takes a system family (`monospace`, `serif`). A name a platform does not find leaves
the system font, with the weights. A name that works on both: load the font with `expo-font` under its PostScript
name (`useFonts({ 'Inter-Regular': require('./Inter-Regular.ttf') })`) and pass that name. `labelFontWeight` and
`inputFontWeight` apply to the font on both: iOS takes the bold face of the family from 600, Android the face of
that weight where the font has one (a family registered with `expo-font`, `<name>_bold` in `assets/fonts` from 600)
and otherwise draws the regular face heavier. Android looks the font up when the theme arrives, so render the form
once the fonts are loaded (`useFonts` returns `true`); a font loaded later applies only with the next theme.

**Language.** `locale` picks one of the SDK's languages by code (`'cs'`, `'en'`, `'de'`, …). `localeStrings` sets
the strings directly and takes precedence over `locale`. It needs all 12 keys of `GopayLocaleStrings` (`panLabel`,
`panPlaceholder`, `expLabel`, `expPlaceholder`, `cvvLabel`, `cvvPlaceholder`, `pay`, `panErrorPattern`,
`expErrorPattern`, `cvvErrorPattern`, `patternErrorMessage`, `requiredErrorMessage`): a set with a key missing is
ignored, with a warning in development, and the form follows `locale`. `pay` is for the app's own button; the form
has none. The optional `screenCaptureNotice` is iOS only: the text the iOS form shows over itself while the screen
is recorded or mirrored. Left out, that cover shows no text, as in the iOS SDK. Android has no such cover, it keeps
the window out of captures (`FLAG_SECURE`), and ignores the key.

**Custom locales.** `GopayConfig.customLocales` registers your own translations with `initialize`, by locale code,
each a complete `GopayLocaleStrings`. They take precedence over the SDK's language of the same code, and `locale`
on the form (or in the config) selects them:

```tsx
GopaySDK.initialize({ environment: 'sandbox', clientId, shareableKey, customLocales: { sk: slovakStrings } });

<PaymentCardForm formId="checkout" locale="sk" />;
```

The native SDKs keep only the language part of a code (`'sk-SK'` is `'sk'`), so keep one code per language: two
that reduce to one (`'cs'` and `'cs-CZ'`) both go to the native SDKs, with a warning in development, and which of
them the form uses is not defined. An entry with a key missing is left out, with a warning in development, and
`initialize` registers the others. A later `initialize` adds its entries
and replaces those of the same code, but removes none: an entry the new config leaves out stays registered on both
platforms (checked on iOS and Android) until the app is restarted, also after a reload of the JS bundle. To take a
translation back, register the replacement under the same code.

**Validation.** `validation` decides when the form shows its own errors under the fields, in the language of the
form: `'hidden'` never (the app shows its own); `'live'` for a field once the user is done with it, and after a
submit for every field typed into, while an empty field is never marked in this mode; `'onSubmit'` for every
invalid field, empty ones included, once a submit was attempted.

On iOS, set `validation` (and whether you drive `submitAttempted`) before the form appears. The iOS SDK keeps the
mode the form appeared with for what `submitCardForm` and `clearCardFormData` do to the submit flag: a form that
appeared with `'hidden'` and was switched to `'onSubmit'` shows no errors on a submit, and one that appeared without
a driven flag does not lower yours when it is emptied. The fields show the new mode at once; for the rest, mount the
form again (a `key` that changes with the mode). Android takes a new mode at once.

**`onValidityChange`** is told whether the card in the form passes its validation: when the form appears, whenever
that flips, and `false` when the form leaves. Use it to enable the pay button. On Android a configuration change
that recreates the Activity (a change of the font size or the language; a rotation does not recreate it in a
default Expo app) is the native form's own case: the form that leaves reports nothing, and the form that comes back
reports the card it took over. iOS has no such case.

**`submitAttempted`** is the flag by which `'onSubmit'` shows the errors of every invalid field and `'live'` those
of every field typed into: whether a submit was attempted since the fields were last emptied. Left out, the form
keeps it: `submitCardForm` raises it, emptying the form (a successful submit, `clearCardFormData`) lowers it. Set it
to raise the errors yourself, for example when your pay button is tapped before you call the SDK. Then the value you
pass is the flag, as in the native SDKs: `onSubmitAttemptedChange` tells you when the SDK changes it (`false` also
when the mounted form leaves the window, a screen a navigator detaches or `removeClippedSubviews`, on both
platforms; when you unmount the component, no event reaches it, so lower your flag yourself there), and you store
the value and pass it back, or the flag stays as you set it. Store it in the handler itself, synchronously, as
`setAttempted` below does. Passing it back raises no new event. Until the component renders after the event, the
render your stored value arrives with, the form keeps the value it reported, so that a second change right after it,
a failed `submitCardForm` and `clearCardFormData` in its `catch`, is not lost. `onSubmitAttemptedChange` is told
nothing while `submitAttempted` is left out.

The platforms differ here, as the native SDKs do:

- `submitCardForm` reports `true` on iOS only in `'live'` and `'onSubmit'`; on Android in `'hidden'` too.
- On iOS, decide before the form appears whether you drive the flag (see Validation).
- When you stop driving it (pass `undefined` after a value), the iOS form goes back to its own flag as it was before
  you drove it, while the Android form starts from the last value it showed.
- On Android below native SDK 3.2.0, a `submitCardForm` that fails at once (an invalid card) followed by
  `clearCardFormData` within the same frame may leave the flag `true` on the emptied form: the Android SDK judges the
  clear against the flag of the last composition. Lower your flag yourself after such a clear.

```tsx
const [attempted, setAttempted] = useState(false);

<PaymentCardForm
  formId="checkout"
  validation="onSubmit"
  submitAttempted={attempted}
  onSubmitAttemptedChange={setAttempted}
/>;
```

**`allowsAutofill`** lets the system offer a saved card for the card number and the expiry: iOS autofill (the
expiry from iOS 17), Android autofill services. Never the CVV.

### Paying by card

The card is charged on the payment's session; the charge goes through the native SDK, which adds the device's
browser data for 3DS. Step by step:

```ts
import { GopayError, GopaySDK, PaymentCardForm } from '@gopaycz/gopay-react-native-sdk';

// 1. When the checkout opens: the session, with the pair your backend created the payment with.
const session = await GopaySDK.startPaymentSession({ paymentId, paymentSecret });

// 2. The user types the card into <PaymentCardForm formId="checkout" />, then taps Pay:
const jwe = await GopaySDK.submitCardForm('checkout');
await session.chargeWithEncryptedCard(jwe); // or session.chargeWithCardToken(cardToken)

// 3. Wait until the charge is decided; the SDK shows the 3DS challenge itself.
try {
  await session.awaitChargeState({ returnUrl, onStateChange: (charge) => setState(charge.state) });
} catch (error) {
  // PAYMENT_006: declined, PAYMENT_007: not decided in time, PAYMENT_011: the user closed 3DS, …
  if (error instanceof GopayError) console.warn(error.code, error.chargeState?.state);
}

// 4. The result to show, and the session closed.
const { outcome } = await session.getPaymentOutcome(); // 'PAID', 'DECLINED', …
await session.close();
```

- **`chargeWithEncryptedCard(jwe, options?)`** charges with the JWE from `submitCardForm`; the gateway takes each
  JWE once. **`chargeWithCardToken(cardToken, options?)`** charges with a permanent card token your backend got
  from the gateway. Both resolve with the charge as the gateway answered (often `'REQUESTED'` or
  `'ACTION_REQUIRED'`); a refused charge throws, with the charge as `chargeState` when the native error has it.
  Do not log the JWE or the token.
- **`options.challengePreference`**: `'AUTO'`, `'CHALLENGE_PREFERRED'` or `'NO_CHALLENGE_PREFERRED'`, forwarded to
  the gateway; without it the charge sends none.
- **`awaitChargeState(options?)`** polls the charge until it is decided and resolves with it once it is
  `'SUCCEEDED'`. A `'FAILED'` charge throws `PAYMENT_006`, a charge still undecided after `initialTimeoutMs`
  throws `PAYMENT_007` (the charge is not over then: read `getChargeState()` or wait for your backend's
  notification), both with the charge as `chargeState`. On a payment that has no charge yet the wait ends at
  once with `PAYMENT_012`, as in the native SDKs, not with a timeout. Options, each with the native default when
  left out:
  - `intervalMs`: the pause between two reads, default `1000`.
  - `initialTimeoutMs`: how long the charge may stay undecided, default `30000`, counted from the call. A 3DS
    challenge lifts it; after an automatic challenge it starts again.
  - `threeDSMode`: `'automatic'` (default) opens the 3DS challenge in the native SDK and polls on once it closes.
    `'manual'` only reports the address through `onActionRequired` and polls on without a timeout; the challenge
    is then yours to run, and nothing opens. Any other value throws `VALIDATION_007`, so that a misspelt
    `'manual'` never opens a challenge the app meant to run.
  - `returnUrl`: the `callback.return_url` the payment was created with, where the automatic challenge ends.
    Without a usable one (missing, not `http(s)` or without a host), the SDK waits for `GopaySDK.chargeReturnUrl`
    instead, and then the payment has to be created with that address, on both platforms.
  - `onStateChange(charge)`: every charge state the call reads, the last one included.
  - `onActionRequired(redirectUrl)`: once for each new 3DS address, before the call settles (see below).

  Zero, a negative time or `NaN` throws `VALIDATION_007` on both platforms before anything is read. The
  SDK finds the screen for the challenge itself.

**Callbacks.** `onStateChange` and `onActionRequired` run in the order the native SDK calls them, and all of them
have run before the `Promise` of `awaitChargeState` resolves or rejects. They come from native as events, so they
run a moment after the native SDK reads the state, never during the read. The callbacks are dropped when the call
ends; two waits on the same payment each get only their own states. Two differences from the native SDKs follow:

- `onActionRequired` runs before the `Promise` settles, but not before the challenge opens: in `'automatic'` mode
  the native SDK opens it without waiting for JS, so the challenge may be on screen already when the callback
  runs. (Natively the callback runs before the challenge opens.)
- An exception thrown by a callback does not end the wait: the bridge logs it with `console.error` and the call
  ends as the native SDK ends it. On Android, by contrast, a native `onStateChange` or `onActionRequired` that
  throws ends the call with that exception; on iOS the callbacks cannot throw.

A closed handle answers `AUTH_013` at once. Closing the session while a wait runs, by its last handle or by
`closeAllPaymentSessions()`, ends the wait with `AUTH_013` at its next read.

**After a reload** JS no longer hears a wait that was running. On Android the bridge's native calls are cancelled
with the old JS context, so the wait stops and an automatic 3DS challenge that is open closes; on iOS the wait runs
on to its end and its states go nowhere. Nothing is charged twice either way: after the reload, read
`getChargeState()` or `getPaymentOutcome()` on the session, which stays, before you offer to pay again.

### Error callback

`errorCallback` in the config gets each error the native SDK reports, once, for central logging:

```ts
GopaySDK.initialize({ environment: 'sandbox', clientId, shareableKey, errorCallback: (error) => log(error) });
```

- The error is also thrown by the call as usual; the callback does not replace catching it. It comes as an
  event, so it may arrive a moment after the call has thrown.
- Not every `GopayError` a call throws reaches it. The native SDKs leave out `PAYMENT_007` and `PAYMENT_011`,
  which are outcomes of a payment window rather than failures. The errors the bridge makes itself never reach it:
  `AUTH_013` of a closed handle or of a session the native SDK no longer has, and `VALIDATION_007` of an unknown
  `threeDSMode`. On Android a failed `initialize` (`CONFIG_006`) reaches the callback of that config; on iOS
  `initialize` does not fail and the first request reports it.
- Each `initialize` replaces the callback; one without `errorCallback` removes it. An error the native SDK
  reports just before a second `initialize` replaces the callback may reach neither callback; the call throws it
  all the same. A callback that throws is logged with `console.error`. After a reload, call `initialize` again:
  until then no callback is set in JS.
- The callback never changes what `initialize` does with the open sessions: a second `initialize` with the same
  connection keeps them, with a callback or without one.

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
again. Switches under the form set its `theme` (the default or one with all 28 keys), `locale` (`xx` is the custom
locale `initialize (customLocales xx)` registers), `validation`,
`allowsAutofill` and a driven `submitAttempted`, and the line under it shows `onValidityChange` and
`onSubmitAttemptedChange`. Type the card into the form by hand; the result shows only the length of the JWE and
how many parts it has, never the JWE itself. A successful submit needs the merchant's keys in `example/.env.local`.

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
