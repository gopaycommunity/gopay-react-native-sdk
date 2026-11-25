package cz.gopay.reactnative

import cz.gopay.sdk.GopaySDK
import cz.gopay.sdk.config.GopayConfig
import cz.gopay.sdk.config.GopayEnvironment
import cz.gopay.sdk.exception.GopayErrorCodes
import cz.gopay.sdk.exception.GopaySDKException
import cz.gopay.sdk.model.QrCodeFormat
import cz.gopay.sdk.session.PaymentSession
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

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
 */
class GopayReactNativeSDKModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GopayReactNativeSDK")

    // `GopaySDK.version` of the linked native SDK.
    Constant("version") {
      GopaySDK.version
    }

    Constant("chargeReturnUrl") {
      GopaySDK.chargeReturnUrl
    }

    // The Activity in front when the module has one, so that the SDK knows the screen at once;
    // otherwise the application Context, and the SDK learns the screen at its next onResume.
    Function("initialize") { config: NativeConfig ->
      envelope {
        val context = appContext.currentActivity
          ?: appContext.reactContext?.applicationContext
          ?: throw Exceptions.ReactContextLost()
        GopaySDK.initialize(context, config.gopayConfig())
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
      Events("onFormHeightChange")

      Prop("formId") { view: PaymentCardFormView, formId: String ->
        view.formId = formId
      }
    }
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
  @Field val requestTimeoutMs: Double = 30_000.0

  /** Throws `CONFIG_006` for a development base URL the SDK refuses. */
  fun gopayConfig() = GopayConfig(
    environment = when (environment) {
      "production" -> GopayEnvironment.PRODUCTION
      "development" -> GopayEnvironment.DEVELOPMENT(baseUrl ?: "")
      else -> GopayEnvironment.SANDBOX
    },
    clientId = clientId,
    shareableKey = shareableKey,
    requestTimeoutMs = requestTimeoutMs.toLong(),
    debugLoggingEnabled = debugLoggingEnabled,
    locale = locale
  )
}

/** The result of [body], or the `GopaySDKException` it throws as data. Anything else is rethrown. */
internal inline fun envelope(body: () -> Any?): Map<String, Any?> = try {
  mapOf("result" to body())
} catch (e: GopaySDKException) {
  mapOf("error" to e.bridged())
}

private fun GopaySDKException.bridged(): Map<String, Any> = compact(
  "code" to code,
  "message" to (message ?: code),
  "httpStatus" to httpStatus,
  "chargeState" to chargeState?.bridged(),
  "gatewayError" to httpContext?.gatewayError?.let {
    compact("error" to it.error, "message" to it.message, "detail" to it.detail)
  }
)
