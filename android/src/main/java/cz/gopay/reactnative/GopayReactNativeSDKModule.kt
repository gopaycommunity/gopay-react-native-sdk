package cz.gopay.reactnative

import cz.gopay.sdk.GopaySDK
import cz.gopay.sdk.config.GopayConfig
import cz.gopay.sdk.config.GopayEnvironment
import cz.gopay.sdk.exception.ErrorCallback
import cz.gopay.sdk.exception.GopayErrorCodes
import cz.gopay.sdk.exception.GopaySDKException
import cz.gopay.sdk.model.ChallengePreference
import cz.gopay.sdk.model.ChargePaymentResponse
import cz.gopay.sdk.model.QrCodeFormat
import cz.gopay.sdk.session.AwaitChargeOptions
import cz.gopay.sdk.session.PaymentSession
import cz.gopay.sdk.session.ThreeDSMode
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.ceil

/**
 * The bridge to `GopaySDK` of the native Android SDK. It adds no payment logic.
 *
 * Every function that can fail returns an envelope, `{"result": …}` or `{"error": …}` with every
 * field of `GopaySDKException`: a rejected Expo promise would carry only a code and a message, and
 * the JS layer throws `GopayError` from the envelope. An exception that is not a
 * `GopaySDKException` is not dressed up as one; it rejects the promise as Expo does.
 *
 * A session is addressed by its `paymentId`; the SDK keeps the sessions. Neither the
 * `payment_secret` nor a token or key goes back to JS or into a log.
 *
 * The SDK's callbacks reach JS as the module's events, each with the id JS gave the call or the
 * callback (see `src/callbacks.ts`). `awaitChargeState` answers with how many events it sent,
 * because Expo does not order an event against the answer of a function.
 */
class GopayReactNativeSDKModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GopayReactNativeSDK")

    Events("onChargeStateChange", "onChargeActionRequired", "onGopayError")

    // `GopaySDK.version` of the linked native SDK.
    Constant("version") {
      GopaySDK.version
    }

    Constant("chargeReturnUrl") {
      GopaySDK.chargeReturnUrl
    }

    // The Activity in front when the module has one, so that the SDK knows the screen at once;
    // otherwise the application Context, and the SDK learns the screen at its next onResume.
    // A config with the same connection keeps the open sessions whatever its callback: the SDK
    // compares the connection only (not `GopayConfig.equals`, which takes in the callback).
    Function("initialize") { config: NativeConfig ->
      envelope {
        val context = appContext.currentActivity
          ?: appContext.reactContext?.applicationContext
          ?: throw Exceptions.ReactContextLost()
        GopaySDK.initialize(context, config.gopayConfig(errorCallback(config.errorCallbackId)))
        null
      }
    }

    AsyncFunction("startPaymentSession") Coroutine { paymentId: String, paymentSecret: String, scope: String? ->
      envelope {
        GopaySDK.getInstance()
          .startPaymentSession(paymentId, paymentSecret, scope ?: PaymentSession.DEFAULT_SCOPE)
          .paymentId
      }
    }

    AsyncFunction("hasPaymentSession") { paymentId: String ->
      envelope { sdkOrNull()?.getPaymentSession(paymentId) != null }
    }

    AsyncFunction("closeAllPaymentSessions") { ->
      envelope {
        sdkOrNull()?.closeAllPaymentSessions()
        null
      }
    }

    AsyncFunction("sessionGetStatus") Coroutine { paymentId: String ->
      envelope { session(paymentId).getStatus().bridged() }
    }

    AsyncFunction("sessionGetPaymentOutcome") Coroutine { paymentId: String ->
      envelope { session(paymentId).getPaymentOutcome().bridged() }
    }

    AsyncFunction("sessionGetChargeState") Coroutine { paymentId: String ->
      envelope { session(paymentId).getChargeState().bridged() }
    }

    AsyncFunction("sessionGetQrPaymentInfo") Coroutine { paymentId: String, format: String? ->
      envelope {
        val qrFormat = when (format) {
          "png" -> QrCodeFormat.PNG
          "svg" -> QrCodeFormat.SVG
          else -> null
        }
        session(paymentId).getQrPaymentInfo(qrFormat).bridged()
      }
    }

    // The card charges. The JWE and the token go to the SDK only; the browser data is the SDK's.
    AsyncFunction("sessionChargeWithEncryptedCard") Coroutine { paymentId: String, jwe: String, challengePreference: String? ->
      envelope {
        session(paymentId)
          .chargeWithEncryptedCard(jwe, challengePreference = challengePreferenceOf(challengePreference))
          .bridged()
      }
    }

    AsyncFunction("sessionChargeWithCardToken") Coroutine { paymentId: String, cardToken: String, challengePreference: String? ->
      envelope {
        session(paymentId)
          .chargeWithCardToken(cardToken, challengePreference = challengePreferenceOf(challengePreference))
          .bridged()
      }
    }

    // Each callback JS asked for sends an event with `callId`; the answer says how many were sent.
    AsyncFunction("sessionAwaitChargeState") Coroutine { paymentId: String, callId: String, options: NativeAwaitChargeOptions ->
      val sent = AtomicInteger()
      val onStateChange: ((ChargePaymentResponse) -> Unit)? = if (options.reportStateChanges) {
        { charge ->
          sent.incrementAndGet()
          sendEvent("onChargeStateChange", mapOf("callId" to callId, "charge" to charge.bridged()))
        }
      } else null
      val onActionRequired: ((String) -> Unit)? = if (options.reportActionRequired) {
        { redirectUrl ->
          sent.incrementAndGet()
          sendEvent("onChargeActionRequired", mapOf("callId" to callId, "redirectUrl" to redirectUrl))
        }
      } else null
      val answer = envelope {
        // The session first, as the SDK answers a closed session whatever the options say.
        val session = session(paymentId)
        session.awaitChargeState(options.awaitChargeOptions(onStateChange, onActionRequired)).bridged()
      }
      answer + ("events" to sent.get())
    }

    // Closing a session the SDK no longer has does nothing, as closing a closed session does.
    AsyncFunction("sessionClose") { paymentId: String ->
      envelope {
        sdkOrNull()?.getPaymentSession(paymentId)?.close()
        null
      }
    }

    // The card form. The card stays in the SDK; only the JWE and the card's metadata come back.
    // Before `initialize`, getInstance() answers CONFIG_001, as the iOS SDK does.
    AsyncFunction("submitCardForm") Coroutine { formId: String ->
      envelope { GopaySDK.getInstance().submitCardForm(formId) }
    }

    AsyncFunction("submitCardFormWithMetadata") Coroutine { formId: String ->
      envelope { GopaySDK.getInstance().submitCardFormWithMetadata(formId).bridged() }
    }

    // Never throws. Before `initialize` the Android SDK has no instance to clear through, so the
    // bridge does nothing and a form on screen keeps its card; the iOS SDK empties it. A
    // difference of the native SDKs, left as it is.
    Function("clearCardFormData") { formId: String ->
      sdkOrNull()?.clearCardFormData(formId)
      Unit
    }

    // The SDK's `PaymentCardForm`, hosted as it is (see PaymentCardFormView.kt).
    View(PaymentCardFormView::class) {
      Events("onFormHeightChange", "onFormValidityChange", "onFormSubmitAttemptedChange")

      Prop("formId") { view: PaymentCardFormView, formId: String ->
        view.formId = formId
      }

      // A prop JS leaves out, or drops later, arrives as null: the SDK's default.
      Prop("theme") { view: PaymentCardFormView, theme: Map<String, Any?>? ->
        view.theme = bridgedTheme(theme, view.context)
      }

      Prop("locale") { view: PaymentCardFormView, locale: String? ->
        view.locale = locale
      }

      Prop("localeStrings") { view: PaymentCardFormView, localeStrings: Map<String, Any?>? ->
        view.localeStrings = bridgedLocaleStrings(localeStrings)
      }

      Prop("validation") { view: PaymentCardFormView, validation: String? ->
        view.validation = bridgedValidation(validation)
      }

      Prop("allowsAutofill") { view: PaymentCardFormView, allowsAutofill: Boolean? ->
        view.allowsAutofill = allowsAutofill ?: false
      }

      Prop("submitAttempted") { view: PaymentCardFormView, submitAttempted: Boolean? ->
        view.submitAttempted = submitAttempted
      }

      // Internal: the number of the last onFormSubmitAttemptedChange JS has answered.
      Prop("submitAttemptedAck") { view: PaymentCardFormView, ack: Double? ->
        view.submitAttemptedAck = ack?.toInt() ?: 0
      }
    }
  }

  /**
   * `GopayConfig.errorCallback` for an `errorCallback` of JS, registered there as [callbackId]:
   * it sends each error as `onGopayError`, in the shape of the envelope's error.
   */
  private fun errorCallback(callbackId: String?): ErrorCallback? = callbackId?.let { id ->
    ErrorCallback { error -> sendEvent("onGopayError", mapOf("callbackId" to id, "error" to error.bridged())) }
  }

  /**
   * The SDK, or null before `initialize`. `getInstance()` would throw `CONFIG_001` there, where
   * the iOS SDK has an empty registry: no session, nothing to close. The bridge answers as iOS does.
   */
  private fun sdkOrNull(): GopaySDK? = if (GopaySDK.isInitialized()) GopaySDK.getInstance() else null

  /** The SDK's session for [paymentId], or `AUTH_013` as a call on a closed session throws it. */
  private fun session(paymentId: String): PaymentSession =
    sdkOrNull()?.getPaymentSession(paymentId) ?: throw GopaySDKException(
      code = GopayErrorCodes.AUTH_PAYMENT_SESSION_CLOSED,
      message = "PaymentSession for $paymentId is closed"
    )
}

/** `GopayConfig` as JS sends it; the JS layer fills in the defaults. */
class NativeConfig : Record {
  @Field val environment: String = "sandbox"
  @Field val baseUrl: String? = null
  @Field val clientId: String? = null
  @Field val shareableKey: String? = null
  @Field val debugLoggingEnabled: Boolean = false
  @Field val locale: String? = null
  /** Locale code to its strings; JS sends only complete sets, and one that is not is skipped here. */
  @Field val customLocales: Map<String, Any?>? = null
  @Field val requestTimeoutMs: Double = 30_000.0
  @Field val errorCallbackId: String? = null

  /** Throws `CONFIG_006` for a development base URL the SDK refuses. */
  fun gopayConfig(errorCallback: ErrorCallback?) = GopayConfig(
    environment = when (environment) {
      "production" -> GopayEnvironment.PRODUCTION
      "development" -> GopayEnvironment.DEVELOPMENT(baseUrl ?: "")
      else -> GopayEnvironment.SANDBOX
    },
    clientId = clientId,
    shareableKey = shareableKey,
    requestTimeoutMs = requestTimeoutMs.toLong(),
    debugLoggingEnabled = debugLoggingEnabled,
    errorCallback = errorCallback,
    locale = locale,
    customLocales = customLocales.orEmpty().mapNotNull { (code, strings) ->
      bridgedLocaleStrings(strings.asStringMap())?.let { code to it }
    }.toMap()
  )
}

/** `AwaitChargeOptions` as JS sends it. A time left out keeps the SDK's default. */
class NativeAwaitChargeOptions : Record {
  @Field val intervalMs: Double? = null
  @Field val initialTimeoutMs: Double? = null
  @Field val threeDSMode: String? = null
  @Field val returnUrl: String? = null
  @Field val reportStateChanges: Boolean = false
  @Field val reportActionRequired: Boolean = false

  /**
   * `activity` stays null: the SDK opens the challenge from the screen in front. The SDK judges
   * the times, a non-positive one too, and the return URL, falling back to chargeReturnUrl.
   *
   * Throws `VALIDATION_007`, as the SDK does for a time that is not positive, for a `threeDSMode`
   * that is neither of the two: taken as automatic, it would open a challenge the app meant to run.
   */
  fun awaitChargeOptions(
    onStateChange: ((ChargePaymentResponse) -> Unit)?,
    onActionRequired: ((String) -> Unit)?
  ) = AwaitChargeOptions(
    intervalMs = intervalMs?.let(::millis) ?: AwaitChargeOptions.DEFAULT_INTERVAL_MS,
    initialTimeoutMs = initialTimeoutMs?.let(::millis) ?: AwaitChargeOptions.DEFAULT_INITIAL_TIMEOUT_MS,
    threeDSMode = when (threeDSMode) {
      null, "automatic" -> ThreeDSMode.AUTOMATIC
      "manual" -> ThreeDSMode.MANUAL
      else -> throw GopaySDKException(
        code = GopayErrorCodes.VALIDATION_INVALID_INPUT,
        message = "awaitChargeState needs threeDSMode 'automatic' or 'manual'"
      )
    },
    returnUrl = returnUrl,
    onStateChange = onStateChange,
    onActionRequired = onActionRequired
  )
}

/**
 * Milliseconds from JS as the SDK takes them. A positive fraction rounds up, so that it stays
 * positive as it does in the seconds of iOS. Zero, a negative value and NaN become 0 or less,
 * which the SDK refuses with `VALIDATION_007` as the iOS SDK does; a huge value is capped at
 * `Long.MAX_VALUE`.
 */
private fun millis(value: Double): Long = if (value > 0) ceil(value).toLong() else value.toLong()

/** The SDK's `ChallengePreference` for its API value, or null for none. */
private fun challengePreferenceOf(value: String?): ChallengePreference? =
  ChallengePreference.entries.firstOrNull { it.name == value }

/** The result of [body], or the `GopaySDKException` it throws as data. Anything else is rethrown. */
internal inline fun envelope(body: () -> Any?): Map<String, Any?> = try {
  mapOf("result" to body())
} catch (e: GopaySDKException) {
  mapOf("error" to e.bridged())
}

/** Every field of the exception JS sees, as the envelope and the `onGopayError` event carry it. */
private fun GopaySDKException.bridged(): Map<String, Any> = compact(
  "code" to code,
  "message" to (message ?: code),
  "httpStatus" to httpStatus,
  "chargeState" to chargeState?.bridged(),
  "gatewayError" to httpContext?.gatewayError?.let {
    compact("error" to it.error, "message" to it.message, "detail" to it.detail)
  }
)
