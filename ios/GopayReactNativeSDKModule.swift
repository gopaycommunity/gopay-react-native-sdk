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
public class GopayReactNativeSDKModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GopayReactNativeSDK")

    // `GopaySDK.version` of the linked native SDK.
    Constant("version") {
      GopaySDK.version
    }

    Constant("chargeReturnUrl") {
      GopaySDK.chargeReturnUrl
    }

    Function("initialize") { (config: NativeConfig) -> [String: Any] in
      GopaySDK.shared.initialize(with: config.gopayConfig())
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

    // Closing a session the SDK no longer has does nothing, as closing a closed session does.
    AsyncFunction("sessionClose") { (paymentId: String) async -> [String: Any] in
      await GopaySDK.shared.getPaymentSession(paymentId)?.close()
      return Envelope.success(nil)
    }
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

  func gopayConfig() -> GopayConfig {
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
      locale: locale,
      // JS has milliseconds, the iOS SDK seconds.
      requestTimeout: requestTimeoutMs / 1000
    )
  }
}

enum Envelope {
  static func success(_ result: Any?) -> [String: Any] {
    ["result": result ?? NSNull()]
  }

  static func failure(_ error: GopaySDKError) -> [String: Any] {
    var bridged: [String: Any] = ["code": error.code.rawValue, "message": error.message]
    bridged["httpStatus"] = error.httpStatus
    bridged["chargeState"] = error.chargeState?.bridged
    if let gateway = error.gatewayError {
      bridged["gatewayError"] = compact([
        "error": gateway.error, "message": gateway.message, "detail": gateway.detail,
      ])
    }
    return ["error": bridged]
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
