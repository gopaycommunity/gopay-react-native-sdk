import GopaySDK
import SwiftUI

// The card form's props as JS sends them, turned into the SDK's types. The JS component has
// already left out every key with a value the form cannot use and warned about it in development;
// what still does not fit here is skipped as well, so the form keeps its default and never fails on
// a prop. Nothing about the card passes through here.

extension PaymentCardFormTheme {
  /// The SDK's default theme with the keys JS set. A key JS left out keeps the SDK's default,
  /// including the colors that follow light and dark mode: nothing is filled in here. A number
  /// outside the limits the JS layer checks (`PAYMENT_CARD_FORM_THEME_LIMITS`) is skipped like a
  /// missing key, as on Android.
  init(bridged values: [String: Any]?) {
    self.init()
    guard let values else { return }
    let read = BridgedValues(values)

    if let value = read.string("fontFamily") { fontFamily = value }

    if let value = read.color("labelColor") { labelColor = value }
    if let value = read.fontSize("labelFontSize") { labelFontSize = value }
    if let value = read.weight("labelFontWeight") { labelFontWeight = value }
    if let value = read.lineHeight("labelLineHeight") { labelLineHeight = value }
    if let value = read.bool("labelUppercase") { labelUppercase = value }
    if let value = read.letterSpacing("labelLetterSpacing") { labelLetterSpacing = value }
    if let value = read.bool("labelHidden") { labelHidden = value }

    if let value = read.color("inputTextColor") { inputTextColor = value }
    if let value = read.fontSize("inputFontSize") { inputFontSize = value }
    if let value = read.weight("inputFontWeight") { inputFontWeight = value }
    if let value = read.length("inputHeight") { inputHeight = value }
    if let value = read.color("placeholderColor") { placeholderColor = value }

    if let value = read.color("inputBorderColor") { inputBorderColor = value }
    if let value = read.length("inputBorderWidth") { inputBorderWidth = value }
    if let value = read.color("inputBackgroundColor") { inputBackgroundColor = value }
    if let value = read.length("inputPaddingVertical") { inputPaddingVertical = value }
    if let value = read.length("inputPaddingHorizontal") { inputPaddingHorizontal = value }
    if let value = read.length("inputBorderRadius") { inputBorderRadius = value }

    if let value = read.color("inputErrorBorderColor") { inputErrorBorderColor = value }
    if let value = read.color("errorTextColor") { errorTextColor = value }
    if let value = read.fontSize("errorFontSize") { errorFontSize = value }
    if let value = read.length("errorMinHeight") { errorMinHeight = value }
    if let value = read.length("errorSpacing") { errorSpacing = value }

    if let value = read.length("groupSpacing") { groupSpacing = value }
    if let value = read.length("fieldSpacing") { fieldSpacing = value }
    if let value = read.length("formPadding") { formPadding = value }
    if let value = read.color("formBackgroundColor") { formBackgroundColor = value }
  }
}

extension GopayLocaleStrings {
  /// The strings JS set, or `nil` when one of the 12 shared keys is missing: the SDK takes only a
  /// complete set. `screenCaptureNotice` is iOS's own; left out, it is empty, as in the SDK.
  init?(bridged values: [String: Any]?) {
    guard let values,
          let panLabel = values["panLabel"] as? String,
          let panPlaceholder = values["panPlaceholder"] as? String,
          let expLabel = values["expLabel"] as? String,
          let expPlaceholder = values["expPlaceholder"] as? String,
          let cvvLabel = values["cvvLabel"] as? String,
          let cvvPlaceholder = values["cvvPlaceholder"] as? String,
          let pay = values["pay"] as? String,
          let panErrorPattern = values["panErrorPattern"] as? String,
          let expErrorPattern = values["expErrorPattern"] as? String,
          let cvvErrorPattern = values["cvvErrorPattern"] as? String,
          let patternErrorMessage = values["patternErrorMessage"] as? String,
          let requiredErrorMessage = values["requiredErrorMessage"] as? String
    else { return nil }
    self.init(
      panLabel: panLabel,
      panPlaceholder: panPlaceholder,
      expLabel: expLabel,
      expPlaceholder: expPlaceholder,
      cvvLabel: cvvLabel,
      cvvPlaceholder: cvvPlaceholder,
      pay: pay,
      panErrorPattern: panErrorPattern,
      expErrorPattern: expErrorPattern,
      cvvErrorPattern: cvvErrorPattern,
      patternErrorMessage: patternErrorMessage,
      requiredErrorMessage: requiredErrorMessage,
      screenCaptureNotice: values["screenCaptureNotice"] as? String ?? ""
    )
  }
}

extension PaymentCardFormValidationDisplay {
  /// `'hidden'`, `'live'` or `'onSubmit'`; anything else, or nothing, is the SDK's default `.hidden`.
  init(bridged value: String?) {
    switch value {
    case "live": self = .live
    case "onSubmit": self = .onSubmit
    default: self = .hidden
    }
  }
}

/// The largest values of the theme, those of `PAYMENT_CARD_FORM_THEME_LIMITS` in `src/cardForm.ts`
/// and of the Android mapper.
private enum ThemeLimits {
  static let length = 1000.0
  static let fontSize = 200.0
  static let lineHeight = 400.0
  static let letterSpacing = 100.0
}

/// Typed reads of a dictionary from JS, `nil` for a key that is missing, of another type or, for a
/// number, outside its range.
private struct BridgedValues {
  let values: [String: Any]

  init(_ values: [String: Any]) {
    self.values = values
  }

  /// A number in `range`, never a boolean: both arrive as `NSNumber`.
  private func number(_ key: String, in range: ClosedRange<Double>) -> Double? {
    guard let number = values[key] as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite,
          range.contains(number.doubleValue)
    else { return nil }
    return number.doubleValue
  }

  /// A length in points, 0 to the limit.
  func length(_ key: String) -> CGFloat? {
    number(key, in: 0...ThemeLimits.length).map { CGFloat($0) }
  }

  /// A font size in points, above 0 up to the limit.
  func fontSize(_ key: String) -> CGFloat? {
    number(key, in: 0...ThemeLimits.fontSize).flatMap { $0 > 0 ? CGFloat($0) : nil }
  }

  func lineHeight(_ key: String) -> CGFloat? {
    number(key, in: 0...ThemeLimits.lineHeight).flatMap { $0 > 0 ? CGFloat($0) : nil }
  }

  func letterSpacing(_ key: String) -> CGFloat? {
    number(key, in: -ThemeLimits.letterSpacing...ThemeLimits.letterSpacing).map { CGFloat($0) }
  }

  /// A CSS weight, 100 to 900.
  func weight(_ key: String) -> Int? {
    number(key, in: 100...900).map { Int($0.rounded()) }
  }

  func bool(_ key: String) -> Bool? {
    guard let number = values[key] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
  }

  func string(_ key: String) -> String? {
    values[key] as? String
  }

  /// `#RRGGBB` or `#RRGGBBAA`, the alpha last as in CSS, in sRGB.
  func color(_ key: String) -> Color? {
    guard let string = string(key), string.hasPrefix("#") else { return nil }
    let hex = string.dropFirst()
    guard hex.count == 6 || hex.count == 8, hex.allSatisfy(\.isHexDigit), let value = UInt64(hex, radix: 16) else { return nil }
    let rgba = hex.count == 6 ? value << 8 | 0xFF : value
    return Color(
      .sRGB,
      red: Double((rgba >> 24) & 0xFF) / 255,
      green: Double((rgba >> 16) & 0xFF) / 255,
      blue: Double((rgba >> 8) & 0xFF) / 255,
      opacity: Double(rgba & 0xFF) / 255
    )
  }
}
