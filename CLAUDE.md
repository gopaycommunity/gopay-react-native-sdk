# GoPay React Native SDK

npm package `@gopaycz/gopay-react-native-sdk`: an Expo module that wraps the native GoPay SDKs
for GoPay Payments 4.0. TypeScript in `src/` (compiled to `build/`), Swift in `ios/`, Kotlin in
`android/`, module config in `expo-module.config.json`, and an example development build in
`example/` that takes the package from the repository root. New Architecture only.

## Wraps the native SDKs (IMPORTANT)

The bridge adds no payment logic of its own; it exposes the native SDKs:

- iOS `../gp-gw-ios-sdk`, linked through `spm_dependency` in `ios/GopayReactNativeSDK.podspec`
  (`exactVersion`, product `GopaySDK`, from the GitHub mirror `gopaycommunity/gopay-ios-sdk`).
- Android `../gp-gw-android-sdk`, linked as `cz.gopay:sdk` from Maven Central in
  `android/build.gradle`, with the Compose compiler plugin and Compose BOM in the module.
- The native SDK version is in one place: `gopayNativeSdkVersion` in `package.json`, read by
  both the podspec and `build.gradle`. Raise it there when a new native SDK is released.

Rules:

- **API parity:** JS names and shapes follow the native API, which is the same on both
  platforms (`GopaySDK.version`, not `getSdkVersion`). Where the platforms differ (seconds on
  iOS vs. milliseconds on Android, async vs. sync), the bridge hides it: JS uses milliseconds and
  Promises.
- **Error codes are a shared contract** (`AUTH_*`, `PAYMENT_*`, …) of both native SDKs. Never
  add a code only in React Native; a new code is agreed into the contract of both SDKs first.
- **No card data crosses the bridge.** Card number, CVV, expiry, BIN and the public key stay
  native. Only the JWE and the card metadata go to JS; `payment_secret` only goes in when a
  session starts and is never logged.
  The card form view follows the same rule: no prop, event or function writes into the form or
  reads from it, not even for tests or the example (no `devFill`). Out of the form come only its
  height, its overall validity and the submit flag (`onSubmitAttemptedChange`), nothing else.
  The card is typed by hand. JWE is never logged; the example shows only its length and parts.

## How the bridge works

- **Errors as data.** Every native function that can fail returns an envelope, `{ result }` or
  `{ error: { code, message, httpStatus?, chargeState?, gatewayError? } }`; `unwrap` in `src/envelope.ts` throws
  `GopayError` from it. Never `reject` a native SDK error: Expo's reject carries only a code and a message.
  Anything that is not a native SDK error is rethrown and reaches JS as a plain Expo error, never as a
  `GopayError`.
- **Sessions are handles.** JS keeps no native object, only per `paymentId` a count of the handles it gave out
  and of the starts and gets still asking the native SDK (`src/sessions.ts`, its header comment). The `session*`
  native functions look the session up in the native SDK and answer `AUTH_013` when it is gone; `sessionClose` of
  a missing session does nothing. A handle's `close()` calls `sessionClose` only for the last open handle, and
  only when no start or get is asking (the last of them closes it then, unless it got a handle); a closed handle
  answers `AUTH_013` in JS. A start or get waits for a running close, and asks again when
  `closeAllPaymentSessions` overlapped it. `startPaymentSession` asks `hasPaymentSession` first and returns a
  handle without a native start when the session exists; `AUTH_012` from a racing start also becomes a handle.
  That is one of two places JS differs from native on purpose; the other is `formId`, required in JS for the card
  form and its three calls, where the native SDKs take `nil` for the form that was active last. Race tests answer each native call in a step of its
  own, in both orders; `src/__tests__/sessions.model.test.ts` runs seeded random interleavings against a model of
  the native registry and checks the invariants in its header. Keep that model true to the native SDKs.
- **Callbacks are module events, paired by id.** Expo functions take no JS function, so `onStateChange`,
  `onActionRequired` and `errorCallback` are events (`onChargeStateChange`, `onChargeActionRequired`,
  `onGopayError`, internal names; `src/callbacks.ts`). JS makes up an id for each `awaitChargeState` call and each
  `initialize` with an `errorCallback` (a prefix drawn per JS context, so that after a reload an old native call
  never matches a new id), passes it to native, and native sends it back in every event; JS listens only during the
  call and drops events of other ids. Native sends an event only for a callback JS has. Expo does not order an event
  against a function's answer, so `sessionAwaitChargeState` answers `{ result | error, events }` with the number of
  events it sent, and JS settles the call once that many arrived. A callback that throws is caught and logged with
  `console.error`; the wait goes on as native runs it. `errorCallback` keeps the callbacks of the last successful
  `initialize` and of failed ones after it (Android reports a failed `initialize` to the new config's callback and
  keeps the old one), as the native SDKs do; both native SDKs compare the connection, not the callback, so a new
  callback per `initialize` never closes a session.
- **Before `initialize`** the Android bridge checks `GopaySDK.isInitialized()` and answers as iOS does (no session,
  nothing to close) instead of the native `CONFIG_001`.
- **The card form is hosted, not copied.** `PaymentCardForm` (`src/PaymentCardForm.tsx`) renders the view
  that `View(...)` registers in the one native module: `ios/PaymentCardFormView.swift` puts the SDK's SwiftUI
  `PaymentCardForm` in a `UIHostingController` that is a child of the nearest view controller (moved when that
  changes), at least a point high (SwiftUI lays out nothing without area; that point is transparent while React
  Native gives a height of 0) and clipping the form below in the hosting view, never in the `ExpoView`, whose
  clipping, shadow and outline React Native manages; `PaymentCardFormView.kt` puts the SDK's Compose
  `PaymentCardForm` in a `ComposeView` that uses the lifecycle and saved state owners of its window (the Activity's
  or the dialog's) and sets none. Where Compose would throw (no owner above the view, or no lifecycle owner above
  the child of `android.R.id.content`, where Compose creates the window recomposer), the form is left out with one sentence in the debug log. No field, validator or look of the form
  lives here: the props go to the native `PaymentCardForm` under their own names, the theme mapper
  (`PaymentCardFormProps.swift`, `PaymentCardFormProps.kt`) sets only the keys JS sent and fills in no default, and
  a prop JS leaves out is not passed (the views then use the SDK's default theme and their own copies of the SDK's
  defaults for `validation` and `allowsAutofill`, `hidden` and `false`, which the native SDKs give no way to read:
  keep them equal to the SDK's). The theme numbers have the limits of `PAYMENT_CARD_FORM_THEME_LIMITS`, checked in
  JS and again in both mappers, and `src/__tests__/cardFormMappers.test.ts` holds both mappers to the keys and
  limits of JS. A new prop goes into the same SwiftUI view or Compose call, so the card stays; never key the form by
  a prop. `src/cardForm.ts` drops a theme key or prop the form cannot use, with a warning in development, before it
  crosses, and so does an incomplete entry of `GopayConfig.customLocales`, which the native configs turn into
  `GopayLocaleStrings` with the mapper of `localeStrings`. The native view measures the form at the width React
  Native gives, never at a width of 0 (the parent gives the width; the component warns in development) and on
  Android against an unbounded height and never while the `ComposeView` has no window, which throws. It reports the
  height through the internal event `onFormHeightChange`; the component applies it unless `style` sets a height. The
  internal events `onFormValidityChange` (only changes) and `onFormSubmitAttemptedChange` (only while JS sets
  `submitAttempted`; the view holds the value it reported until JS answers with its number in the internal prop
  `submitAttemptedAck`, then the value JS sent is the flag again; Android also reports `false` when the form leaves
  the window, as the iOS form does) carry one boolean each. Registration, the wipe on unmount and `FLAG_SECURE` are
  the native form's own.
- **Models** are converted by hand on both sides (`bridged` in Swift, `Bridged.kt`), with the native property
  names, enums as their raw values and no entry for a null. `PaymentDetails.paymentSecret` never crosses.
- `GOPAY_ERROR_CODES` in `src/GopayError.ts` is compared with `sdk/docs/ERROR_CODES.md` of both native repos
  when they are checked out next to this one; otherwise (CI) that test is skipped.

## Native SDK differences the bridge works around or documents

The ticket that raises `gopayNativeSdkVersion` goes through this list and removes from RN what the new native
version closed: the workaround in the bridge and the sentence in the README. The codes are those of the
coordination's backlog.

- **R2** Starting a payment session that already exists answers `AUTH_012` on both platforms. JS asks
  `hasPaymentSession` first and turns an `AUTH_012` of a racing start into a handle (`src/sessions.ts`, README
  "Starting the same payment twice"). Remove the question and the `AUTH_012` branch once the native start returns
  the existing session.
- **R3** The native default request timeout differs (iOS 60 s, Android 30 s). The bridge always sends
  `requestTimeoutMs`, 30000 unless set (`toNativeConfig` in `src/GopaySDK.ts`, README `GopayConfig`). Once both
  defaults are the same, send it only when the app sets it and drop the README note.
- **R5** `clearCardFormData` before `initialize` does nothing on Android (no instance), while iOS empties the form.
  Left as it is: a comment in `GopayReactNativeSDKModule.kt` and a sentence in the README section "Card form".
  Remove both once Android clears the form before `initialize`.
- Before `initialize` the Android SDK answers `CONFIG_001` where iOS has an empty registry. The Android bridge checks
  `GopaySDK.isInitialized()` and answers as iOS (`sdkOrNull` in `GopayReactNativeSDKModule.kt`). Remove once Android
  answers as iOS.
- **R9** iOS takes `fontFamily` only as the PostScript or full name of a face (`UIFont(name:)`), not a family name
  or an `expo-font` alias; Android takes React Native's names. README "Card form props", `fontFamily` paragraph.
  Remove the iOS sentences once the iOS SDK resolves family names.
- **R10** On iOS, `validation` and a driven `submitAttempted` changed on a form on screen do not reach what
  `submitCardForm` and `clearCardFormData` do to the flag (the SDK keeps the closures of `onAppear`). README
  "Validation" and the platform list under `submitAttempted`, JSDoc of `validation` and `submitAttempted` in
  `src/PaymentCardForm.tsx`. Remove once the iOS SDK reads the current props.
- **R11** On Android the default colors come from the app theme when the form appears, and an Expo app does not
  recreate its Activity when dark mode switches, so they keep the old mode. README "Card form props", dark mode
  paragraph. Remove once the Android SDK follows the configuration.
- **R12** The driven `submitAttempted` differs: `submitCardForm` reports `true` in `'hidden'` on Android only; a form
  leaving the window lowers the host's flag on iOS but only its own on Android; stopping to drive it restores the
  form's old flag on iOS and keeps the last value on Android. The bridge reports `false` when an Android form with a
  driven `true` leaves the window (`onDetachedFromWindow` in `PaymentCardFormView.kt`); the rest is in the README
  list under `submitAttempted` and the JSDoc of `onSubmitAttemptedChange`. Remove the override and the sentences
  once the native SDKs agree. The override skips an Activity being recreated, where the SDK parks the card and the
  flag. Also on Android below 3.2.0 (fixed in GPMOB-177), a `submitCardForm` that fails at once and a
  `clearCardFormData` in the same frame may leave a driven flag `true`: the SDK compares with the flag of the last
  composition (`rememberUpdatedState`). README list under `submitAttempted` and JSDoc of `submitAttempted`; remove
  both with the raise to 3.2.0, no workaround in the bridge.
- **X7** A second `initialize` adds its `customLocales` but removes none, on both platforms. README "Custom
  locales" and JSDoc of `GopayConfig.customLocales`. Remove the sentences once `initialize` replaces them.

## Conventions

- Conventional commits checked by Husky + commitlint (`commitlint` in `package.json`, same
  rules as the native repos): a Jira reference `GPMOB-` is required, e.g.
  `feat: expose the native SDK version GPMOB-162`.
- Branches `feat/GPMOB-<n>-<slug>` from `master`. Bitbucket Pipelines runs lint, typecheck
  and tests on every pull request (no native build yet) and mirrors `master` to GitHub
  `gopaycommunity/gopay-react-native-sdk`.
- Supported Expo: 58 (recommended) and 57 (minimum), i.e. the current one and one back. The
  package's devDependencies use the same React Native version as `example/`; mismatched
  versions break the Metro bundle.
- `example/ios` and `example/android` are generated by `npx expo prebuild` and not checked in.

## Verifying locally

```bash
npm install && npm run lint && npm run typecheck && npm test
cd example && npm install && LANG=en_US.UTF-8 npx expo prebuild --clean
npx expo run:ios      # or run:android; add --configuration Release / --variant release
```

`pod install` fails without a UTF-8 `LANG`. `npm pack` must contain only `build/`, `src/`,
`ios/`, `android/build.gradle`, `android/src/main` and `expo-module.config.json` (plus
`package.json`, `README.md`, `LICENSE`).
