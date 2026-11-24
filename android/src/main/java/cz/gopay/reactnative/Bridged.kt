package cz.gopay.reactnative

import cz.gopay.sdk.model.ChargePaymentResponse
import cz.gopay.sdk.model.PaymentCustomer
import cz.gopay.sdk.model.PaymentDetails
import cz.gopay.sdk.model.PaymentOutcome
import cz.gopay.sdk.model.QrPaymentDetails

// Models as JS sees them: the property names of the SDK, enums as their names (the gateway's
// values), and no entry for a property that is null, so that JS sees it as missing. Amounts are
// sent as Double, which JS numbers are.

/** [entries] without those whose value is null. */
internal fun compact(vararg entries: Pair<String, Any?>): Map<String, Any> =
  entries.mapNotNull { (key, value) -> value?.let { key to it } }.toMap()

/** Without `paymentSecret`: the bridge never sends a secret back to JS. */
internal fun PaymentDetails.bridged(): Map<String, Any> = compact(
  "id" to id,
  "orderNumber" to orderNumber,
  "state" to state.name,
  "amount" to amount.toDouble(),
  "currency" to currency.name,
  "gatewayUrl" to gatewayUrl,
  "customer" to customer.bridged(),
  "charge" to charge?.bridged()
)

internal fun PaymentCustomer.bridged(): Map<String, Any> = compact(
  "email" to email,
  "firstName" to firstName,
  "lastName" to lastName,
  "phoneNumber" to phoneNumber,
  "city" to city,
  "street" to street,
  "postalCode" to postalCode,
  "countryCode" to countryCode,
  "customerId" to customerId
)

internal fun PaymentOutcome.bridged(): Map<String, Any> = compact(
  "outcome" to outcome.name,
  "payment" to payment.bridged(),
  "charge" to charge?.bridged()
)

internal fun ChargePaymentResponse.bridged(): Map<String, Any> = compact(
  "id" to id,
  "state" to state.name,
  "paymentInstrument" to paymentInstrument?.let { instrument ->
    compact(
      "paymentInstrument" to instrument.paymentInstrument,
      "details" to instrument.details?.let { details ->
        compact(
          "inputType" to details.inputType,
          "maskedPan" to details.maskedPan,
          "expirationMonth" to details.expirationMonth,
          "expirationYear" to details.expirationYear,
          "scheme" to details.scheme?.name,
          "fingerprint" to details.fingerprint
        )
      }
    )
  },
  "action" to action?.let { action ->
    compact(
      "actionType" to action.actionType.name,
      "state" to action.state?.name,
      "redirectUrl" to action.redirectUrl
    )
  },
  "failReason" to failReason
)

internal fun QrPaymentDetails.bridged(): Map<String, Any> = compact(
  "amount" to amount.toDouble(),
  "currency" to currency.name,
  "recipient" to compact(
    "name" to recipient.name,
    "bankAccount" to recipient.bankAccount?.let { account ->
      compact(
        "local" to account.local?.let { local ->
          compact(
            "prefix" to local.prefix,
            "accountNumber" to local.accountNumber,
            "bankCode" to local.bankCode,
            "variableSymbol" to local.variableSymbol
          )
        },
        "international" to account.international?.let { international ->
          compact(
            "bic" to international.bic,
            "iban" to international.iban,
            "reference" to international.reference
          )
        }
      )
    },
    "address" to recipient.address?.let { address ->
      compact(
        "street" to address.street,
        "city" to address.city,
        "zipCode" to address.zipCode,
        "country" to address.country
      )
    }
  ),
  "qrCode" to compact(
    "spayd" to qrCode.spayd,
    "paybysquare" to qrCode.paybysquare,
    "sepa" to qrCode.sepa,
    "mnbQr" to qrCode.mnbQr
  )
)
