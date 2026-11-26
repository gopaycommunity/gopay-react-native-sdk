import ExpoModulesCore
import GopaySDK

/// The bridge to `GopaySDK` of the native iOS SDK. It adds no payment logic.
///
/// Every function that can fail returns an envelope, `["result": …]` or `["error": …]` with every
/// field of `GopaySDKError`: a rejected Expo promise would carry only a code and a message, and
/// the JS layer throws `GopayError` from the envelope. An error that is not a `GopaySDKError` is
/// not dressed up as one; it rejects the promise as Expo does.
///
/// A session is addressed by its `paymentId`; the SDK keeps the sessions. Neither the
/// `payment_secret` nor a token or key goes back to JS or into a log.
///
/// The SDK's callbacks reach JS as the module's events, each with the id JS gave the call or the
/// callback (see `src/callbacks.ts`). `awaitChargeState` answers with how many events it sent,
/// because Expo does not order an event against the answer of a function.
public class GopayReactNativeSDKModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GopayReactNativeSDK")

    Events("onChargeStateChange", "onChargeActionRequired", "onGopayError")

    // `GopaySDK.version` of the linked native SDK.
    Constant("version") {
      GopaySDK.version
    }

    Constant("chargeReturnUrl") {
      GopaySDK.chargeReturnUrl
    }

    // A config with the same connection keeps the open sessions whatever its callback; the SDK
    // compares the connection only, so a new callback for each initialize is safe.
    Function("initialize") { (config: NativeConfig) -> [String: Any] in
      GopaySDK.shared.initialize(with: config.gopayConfig(errorCallback: self.errorCallback(config.errorCallbackId)))
      return Envelope.success(nil)
    }

    AsyncFunction("startPaymentSession") { (paymentId: String, paymentSecret: String, scope: String?) async throws -> [String: Any] in
      try await Envelope.of {
        let session = try await GopaySDK.shared.startPaymentSession(
          paymentId: paymentId,
          paymentSecret: paymentSecret,
          scope: scope ?? PaymentSession.defaultScope
        )
        return session.paymentId
      }
    }

    AsyncFunction("hasPaymentSession") { (paymentId: String) async -> [String: Any] in
      Envelope.success(await GopaySDK.shared.getPaymentSession(paymentId) != nil)
    }

    AsyncFunction("closeAllPaymentSessions") { () async -> [String: Any] in
      await GopaySDK.shared.closeAllPaymentSessions()
      return Envelope.success(nil)
    }

    AsyncFunction("sessionGetStatus") { (paymentId: String) async throws -> [String: Any] in
      try await Envelope.of { try await Self.session(paymentId).getStatus().bridged }
    }

    AsyncFunction("sessionGetPaymentOutcome") { (paymentId: String) async throws -> [String: Any] in
      try await Envelope.of { try await Self.session(paymentId).getPaymentOutcome().bridged }
    }

    AsyncFunction("sessionGetChargeState") { (paymentId: String) async throws -> [String: Any] in
      try await Envelope.of { try await Self.session(paymentId).getChargeState().bridged }
    }

    AsyncFunction("sessionGetQrPaymentInfo") { (paymentId: String, format: String?) async throws -> [String: Any] in
      try await Envelope.of {
        try await Self.session(paymentId).getQrPaymentInfo(format: format.flatMap(QrCodeFormat.init(rawValue:))).bridged
      }
    }

    // The card charges. The JWE and the token go to the SDK only; the browser data is the SDK's.
    AsyncFunction("sessionChargeWithEncryptedCard") { (paymentId: String, jwe: String, challengePreference: String?) async throws -> [String: Any] in
      try await Envelope.of {
        try await Self.session(paymentId).chargeWithEncryptedCard(
          jwe,
          browserData: nil,
          challengePreference: Self.challengePreference(challengePreference)
        ).bridged
      }
    }

    AsyncFunction("sessionChargeWithCardToken") { (paymentId: String, cardToken: String, challengePreference: String?) async throws -> [String: Any] in
      try await Envelope.of {
        try await Self.session(paymentId).chargeWithCardToken(
          cardToken,
          browserData: nil,
          challengePreference: Self.challengePreference(challengePreference)
        ).bridged
      }
    }

    // Each callback JS asked for sends an event with `callId`; the answer says how many were sent.
    AsyncFunction("sessionAwaitChargeState") { (paymentId: String, callId: String, options: NativeAwaitChargeOptions) async throws -> [String: Any] in
      try await self.awaitChargeState(paymentId: paymentId, callId: callId, options: options)
    }

    // Closing a session the SDK no longer has does nothing, as closing a closed session does.
    AsyncFunction("sessionClose") { (paymentId: String) async -> [String: Any] in
      await GopaySDK.shared.getPaymentSession(paymentId)?.close()
      return Envelope.success(nil)
    }

    // The card form. The card stays in the SDK; only the JWE and the card's metadata come back.
    AsyncFunction("submitCardForm") { (formId: String) async throws -> [String: Any] in
      try await Envelope.of { try await GopaySDK.shared.submitCardForm(formId: formId) }
    }

    AsyncFunction("submitCardFormWithMetadata") { (formId: String) async throws -> [String: Any] in
      try await Envelope.of { try await GopaySDK.shared.submitCardFormWithMetadata(formId: formId).bridged }
    }

    // Never throws. The iOS SDK clears also before `initialize` and empties a form on screen; the
    // Android SDK cannot, so there the bridge does nothing (a difference of the native SDKs).
    Function("clearCardFormData") { (formId: String) in
      GopaySDK.shared.clearCardFormData(formId: formId)
    }

    // The SDK's `PaymentCardForm`, hosted as it is (see PaymentCardFormView.swift).
    View(PaymentCardFormView.self) {
      Events("onFormHeightChange")

      Prop("formId") { (view: PaymentCardFormView, formId: String) in
        view.formId = formId
      }
    }
  }

  /// `awaitChargeState` of the session for `paymentId`. Each callback JS asked for sends an event
  /// with `callId`; the answer carries how many were sent as `events`.
  private func awaitChargeState(
    paymentId: String,
    callId: String,
    options: NativeAwaitChargeOptions
  ) async throws -> [String: Any] {
    let events = EventSink(self)
    let sent = EventCount()
    var onStateChange: (@MainActor @Sendable (ChargePaymentResponse) -> Void)?
    if options.reportStateChanges {
      onStateChange = { charge in
        sent.increment()
        events.send("onChargeStateChange", ["callId": callId, "charge": charge.bridged])
      }
    }
    var onActionRequired: (@MainActor @Sendable (String) -> Void)?
    if options.reportActionRequired {
      onActionRequired = { redirectUrl in
        sent.increment()
        events.send("onChargeActionRequired", ["callId": callId, "redirectUrl": redirectUrl])
      }
    }
    var answer = try await Envelope.of {
      // The session first, as the SDK answers a closed session whatever the options say.
      let session = try await Self.session(paymentId)
      let awaitOptions = try options.awaitChargeOptions(onStateChange: onStateChange, onActionRequired: onActionRequired)
      return try await session.awaitChargeState(awaitOptions).bridged
    }
    answer["events"] = sent.value
    return answer
  }

  /// `GopayConfig.errorCallback` for an `errorCallback` of JS, registered there as `callbackId`:
  /// it sends each `GopaySDKError` as `onGopayError`, in the shape of the envelope's error.
  private func errorCallback(_ callbackId: String?) -> (@Sendable (Error) -> Void)? {
    guard let callbackId = callbackId else { return nil }
    let events = EventSink(self)
    return { error in
      guard let error = error as? GopaySDKError else { return }
      events.send("onGopayError", ["callbackId": callbackId, "error": error.bridged])
    }
  }

  /// The SDK's `ChallengePreference` for its API value, or nil for none.
  private static func challengePreference(_ value: String?) -> ChallengePreference? {
    value.flatMap(ChallengePreference.init(rawValue:))
  }

  /// The SDK's session for `paymentId`, or `AUTH_013` as a call on a closed session throws it.
  private static func session(_ paymentId: String) async throws -> PaymentSession {
    guard let session = await GopaySDK.shared.getPaymentSession(paymentId) else {
      throw GopaySDKError(.authPaymentSessionClosed, message: "PaymentSession for \(paymentId) is closed")
    }
    return session
  }
}

/// `GopayConfig` as JS sends it; the JS layer fills in the defaults.
struct NativeConfig: Record {
  @Field var environment: String = "sandbox"
  @Field var baseUrl: String?
  @Field var clientId: String?
  @Field var shareableKey: String?
  @Field var debugLoggingEnabled: Bool = false
  @Field var locale: String?
  @Field var requestTimeoutMs: Double = 30_000
  @Field var errorCallbackId: String?

  func gopayConfig(errorCallback: (@Sendable (Error) -> Void)?) -> GopayConfig {
    let gopayEnvironment: GopayEnvironment
    switch environment {
    case "production": gopayEnvironment = .production
    case "development": gopayEnvironment = .development(baseUrl: baseUrl ?? "")
    default: gopayEnvironment = .sandbox
    }
    return GopayConfig(
      environment: gopayEnvironment,
      clientId: clientId,
      shareableKey: shareableKey,
      debugLoggingEnabled: debugLoggingEnabled,
      errorCallback: errorCallback,
      locale: locale,
      // JS has milliseconds, the iOS SDK seconds.
      requestTimeout: requestTimeoutMs / 1000
    )
  }
}

/// `AwaitChargeOptions` as JS sends it. A time left out keeps the SDK's default.
struct NativeAwaitChargeOptions: Record {
  @Field var intervalMs: Double?
  @Field var initialTimeoutMs: Double?
  @Field var threeDSMode: String?
  @Field var returnUrl: String?
  @Field var reportStateChanges: Bool = false
  @Field var reportActionRequired: Bool = false

  /// Throws `VALIDATION_007`, as the SDK does for a time that is not positive, for a `threeDSMode`
  /// that is neither of the two: taken as automatic, it would open a challenge the app meant to run.
  func awaitChargeOptions(
    onStateChange: (@MainActor @Sendable (ChargePaymentResponse) -> Void)?,
    onActionRequired: (@MainActor @Sendable (String) -> Void)?
  ) throws -> AwaitChargeOptions {
    let mode: ThreeDSMode
    switch threeDSMode {
    case nil, "automatic": mode = .automatic
    case "manual": mode = .manual
    default:
      throw GopaySDKError(
        .validationInvalidInput,
        message: "awaitChargeState needs threeDSMode 'automatic' or 'manual'"
      )
    }
    var options = AwaitChargeOptions(
      threeDSMode: mode,
      // A string that is no URL is as missing as none: the SDK then waits for chargeReturnUrl,
      // as it does for a URL it cannot use and as the Android SDK does for both.
      returnUrl: returnUrl.flatMap(URL.init(string:)),
      onStateChange: onStateChange,
      onActionRequired: onActionRequired
    )
    // JS has milliseconds, the iOS SDK seconds. The SDK judges the value, a non-positive one too.
    if let intervalMs = intervalMs { options.interval = intervalMs / 1000 }
    if let initialTimeoutMs = initialTimeoutMs { options.initialTimeout = initialTimeoutMs / 1000 }
    return options
  }
}

/// Sends the module's events from any thread; holds the module weakly, so that a callback the SDK
/// keeps after a reload sends nothing once the module is gone.
final class EventSink: @unchecked Sendable {
  private weak var module: GopayReactNativeSDKModule?

  init(_ module: GopayReactNativeSDKModule) {
    self.module = module
  }

  func send(_ name: String, _ body: [String: Any]) {
    module?.sendEvent(name, body.mapValues { $0 as Any? })
  }
}

/// How many events one call sent.
final class EventCount: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0

  func increment() {
    lock.lock()
    count += 1
    lock.unlock()
  }

  var value: Int {
    lock.lock()
    defer { lock.unlock() }
    return count
  }
}

enum Envelope {
  static func success(_ result: Any?) -> [String: Any] {
    ["result": result ?? NSNull()]
  }

  static func failure(_ error: GopaySDKError) -> [String: Any] {
    ["error": error.bridged]
  }

  /// The result of `body`, or the `GopaySDKError` it throws as data. Any other error is rethrown.
  static func of(_ body: () async throws -> Any?) async rethrows -> [String: Any] {
    do {
      return success(try await body())
    } catch let error as GopaySDKError {
      return failure(error)
    }
  }
}

/// `values` without the entries that are nil, so that JS sees them as missing.
func compact(_ values: [String: Any?]) -> [String: Any] {
  values.compactMapValues { $0 }
}

extension GopaySDKError {
  /// Every field JS sees, as the envelope and the `onGopayError` event carry it.
  var bridged: [String: Any] {
    var bridged: [String: Any] = ["code": code.rawValue, "message": message]
    bridged["httpStatus"] = httpStatus
    bridged["chargeState"] = chargeState?.bridged
    if let gateway = gatewayError {
      bridged["gatewayError"] = compact([
        "error": gateway.error, "message": gateway.message, "detail": gateway.detail,
      ])
    }
    return bridged
  }
}

// MARK: - Models as JS sees them: the property names of the SDK, enums as their raw values.

extension PaymentDetails {
  /// Without `paymentSecret`: the bridge never sends a secret back to JS.
  var bridged: [String: Any] {
    compact([
      "id": id,
      "orderNumber": orderNumber,
      "state": state.rawValue,
      "amount": amount,
      "currency": currency.rawValue,
      "gatewayUrl": gatewayUrl,
      "customer": customer.bridged,
      "charge": charge?.bridged,
    ])
  }
}

extension PaymentCustomer {
  var bridged: [String: Any] {
    compact([
      "email": email,
      "firstName": firstName,
      "lastName": lastName,
      "phoneNumber": phoneNumber,
      "city": city,
      "street": street,
      "postalCode": postalCode,
      "countryCode": countryCode,
      "customerId": customerId,
    ])
  }
}

extension PaymentOutcome {
  var bridged: [String: Any] {
    compact([
      "outcome": outcome.rawValue,
      "payment": payment.bridged,
      "charge": charge?.bridged,
    ])
  }
}

extension ChargePaymentResponse {
  var bridged: [String: Any] {
    compact([
      "id": id,
      "state": state.rawValue,
      "paymentInstrument": paymentInstrument.map { instrument in
        compact([
          "paymentInstrument": instrument.paymentInstrument,
          "details": instrument.details.map { details in
            compact([
              "inputType": details.inputType,
              "maskedPan": details.maskedPan,
              "expirationMonth": details.expirationMonth,
              "expirationYear": details.expirationYear,
              "scheme": details.scheme?.rawValue,
              "fingerprint": details.fingerprint,
            ])
          },
        ])
      },
      "action": action.map { action in
        compact([
          "actionType": action.actionType.rawValue,
          "state": action.state?.rawValue,
          "redirectUrl": action.redirectUrl,
        ])
      },
      "failReason": failReason,
    ])
  }
}

extension EncryptedCardPayloadWithMetadata {
  var bridged: [String: Any] {
    compact([
      "encryptedPayload": encryptedPayload,
      "cardMetadata": cardMetadata?.bridged,
    ])
  }
}

extension CardMetadata {
  var bridged: [String: Any] {
    compact([
      "scheme": scheme.rawValue,
      "corporate": corporate,
      "brand": brand,
      "serviceType": serviceType?.rawValue,
      "issuer": issuer,
      "issuerCountry": issuerCountry,
    ])
  }
}

extension QrPaymentDetails {
  var bridged: [String: Any] {
    compact([
      "amount": amount,
      "currency": currency.rawValue,
      "recipient": compact([
        "name": recipient.name,
        "bankAccount": recipient.bankAccount.map { account in
          compact([
            "local": account.local.map { local in
              [
                "prefix": local.prefix,
                "accountNumber": local.accountNumber,
                "bankCode": local.bankCode,
                "variableSymbol": local.variableSymbol,
              ]
            },
            "international": account.international.map { international in
              compact([
                "bic": international.bic,
                "iban": international.iban,
                "reference": international.reference,
              ])
            },
          ])
        },
        "address": recipient.address.map { address in
          compact([
            "street": address.street,
            "city": address.city,
            "zipCode": address.zipCode,
            "country": address.country,
          ])
        },
      ]),
      "qrCode": compact([
        "spayd": qrCode.spayd,
        "paybysquare": qrCode.paybysquare,
        "sepa": qrCode.sepa,
        "mnbQr": qrCode.mnbQr,
      ]),
    ])
  }
}
