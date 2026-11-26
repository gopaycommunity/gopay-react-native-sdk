package cz.gopay.reactnative

import android.content.Context
import android.graphics.Typeface
import android.os.Build
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.AndroidFont
import androidx.compose.ui.text.font.AndroidFont.TypefaceLoader
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontLoadingStrategy
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.facebook.react.common.assets.ReactFontManager
import cz.gopay.sdk.locales.GopayLocaleStrings
import cz.gopay.sdk.ui.PaymentCardFormTheme
import cz.gopay.sdk.ui.PaymentCardFormValidationDisplay
import kotlin.math.roundToInt

// The card form's props as JS sends them, turned into the SDK's types. The JS component has already
// left out every key with a value the form cannot use and warned about it in development; what
// still does not fit here is skipped as well, so the form keeps its default and never fails on a
// prop. Nothing about the card passes through here.

/**
 * The SDK's default theme with the keys JS set. A key JS left out keeps the SDK's default, the
 * colors that follow the host theme and its dark variant included: nothing is filled in here.
 * Lengths are dp; font sizes, line height and letter spacing are sp. A number outside the limits
 * the JS layer checks (`PAYMENT_CARD_FORM_THEME_LIMITS`) is skipped like a missing key: Compose
 * measures in 32-bit floats and fails on sizes far beyond a screen. The Android-only
 * `helperTextColor` and `helperFontSize` keep their defaults.
 */
internal fun bridgedTheme(values: Map<String, Any?>?, context: Context): PaymentCardFormTheme {
  val default = PaymentCardFormTheme()
  if (values == null) return default
  val read = BridgedValues(values)
  return PaymentCardFormTheme(
    fontFamily = read.string("fontFamily")?.let { reactFontFamily(it, context) } ?: default.fontFamily,

    labelColor = read.color("labelColor") ?: default.labelColor,
    labelFontSize = read.fontSize("labelFontSize")?.sp ?: default.labelFontSize,
    labelFontWeight = read.weight("labelFontWeight") ?: default.labelFontWeight,
    labelLineHeight = read.lineHeight("labelLineHeight")?.sp ?: default.labelLineHeight,
    labelUppercase = read.bool("labelUppercase") ?: default.labelUppercase,
    labelLetterSpacing = read.letterSpacing("labelLetterSpacing")?.sp ?: default.labelLetterSpacing,
    labelHidden = read.bool("labelHidden") ?: default.labelHidden,

    inputTextColor = read.color("inputTextColor") ?: default.inputTextColor,
    inputFontSize = read.fontSize("inputFontSize")?.sp ?: default.inputFontSize,
    inputFontWeight = read.weight("inputFontWeight") ?: default.inputFontWeight,
    inputHeight = read.length("inputHeight")?.dp ?: default.inputHeight,
    placeholderColor = read.color("placeholderColor") ?: default.placeholderColor,

    inputBorderColor = read.color("inputBorderColor") ?: default.inputBorderColor,
    inputBorderWidth = read.length("inputBorderWidth")?.dp ?: default.inputBorderWidth,
    inputBackgroundColor = read.color("inputBackgroundColor") ?: default.inputBackgroundColor,
    inputPaddingVertical = read.length("inputPaddingVertical")?.dp ?: default.inputPaddingVertical,
    inputPaddingHorizontal = read.length("inputPaddingHorizontal")?.dp ?: default.inputPaddingHorizontal,
    inputBorderRadius = read.length("inputBorderRadius")?.dp ?: default.inputBorderRadius,

    inputErrorBorderColor = read.color("inputErrorBorderColor") ?: default.inputErrorBorderColor,
    errorTextColor = read.color("errorTextColor") ?: default.errorTextColor,
    errorFontSize = read.fontSize("errorFontSize")?.sp ?: default.errorFontSize,
    errorMinHeight = read.length("errorMinHeight")?.dp ?: default.errorMinHeight,
    errorSpacing = read.length("errorSpacing")?.dp ?: default.errorSpacing,

    groupSpacing = read.length("groupSpacing")?.dp ?: default.groupSpacing,
    fieldSpacing = read.length("fieldSpacing")?.dp ?: default.fieldSpacing,
    formPadding = read.length("formPadding")?.dp ?: default.formPadding,
    formBackgroundColor = read.color("formBackgroundColor") ?: default.formBackgroundColor
  )
}

/**
 * The font React Native knows under [name], looked up as a `fontFamily` style is and as `expo-font`
 * looks it up: a font loaded with `expo-font` under that name, then `assets/fonts/<name>.ttf` (or
 * `.otf`), then a system family of that name (`monospace`, `serif`). Null for a name none of them
 * has, so that the form keeps the system font, as iOS does for a name `UIFont(name:)` does not find.
 *
 * One face per weight from 100 to 900, so that `labelFontWeight` and `inputFontWeight` apply to the
 * font as they do on iOS: the face of that weight when the font has one (a family `expo-font`
 * registered, or `<name>_bold` in the assets from 600, as iOS takes the bold face), the regular face
 * drawn heavier otherwise. The font is looked up when the theme arrives: one `expo-font` loads later
 * applies with the next theme.
 */
private fun reactFontFamily(name: String, context: Context): FontFamily? {
  val regular = ReactFontManager.getInstance().getTypeface(name, Typeface.NORMAL, context.assets)
  if (regular == Typeface.DEFAULT) return null
  return FontFamily((100..900 step 100).map { ReactFontFace(name, FontWeight(it)) })
}

/** One weight of the font React Native knows under [name]; loaded, and cached, by Compose. */
private class ReactFontFace(
  private val name: String,
  override val weight: FontWeight
) : AndroidFont(FontLoadingStrategy.Blocking, Loader) {
  override val style: FontStyle = FontStyle.Normal

  override fun equals(other: Any?) = other is ReactFontFace && other.name == name && other.weight == weight

  override fun hashCode() = 31 * name.hashCode() + weight.hashCode()

  private object Loader : TypefaceLoader {
    override fun loadBlocking(context: Context, font: AndroidFont): Typeface {
      val face = font as ReactFontFace
      val fonts = ReactFontManager.getInstance()
      val weight = face.weight.weight
      if (weight >= 600 && hasBoldAsset(face.name, context)) {
        return fonts.getTypeface(face.name, Typeface.BOLD, context.assets)
      }
      val regular = fonts.getTypeface(face.name, Typeface.NORMAL, context.assets)
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        Typeface.create(regular, weight, false)
      } else {
        Typeface.create(regular, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
      }
    }

    override suspend fun awaitLoad(context: Context, font: AndroidFont): Typeface =
      loadBlocking(context, font)

    /** Whether the app has `assets/fonts/<name>_bold.ttf` (or `.otf`), React Native's bold face. */
    private fun hasBoldAsset(name: String, context: Context): Boolean =
      context.assets.list("fonts")?.any { it == "${name}_bold.ttf" || it == "${name}_bold.otf" } == true
  }
}

/**
 * The strings JS set, or null when one of the 12 shared keys is missing: the SDK takes only a
 * complete set. iOS's `screenCaptureNotice` has no counterpart here (the Android form keeps its
 * window out of captures instead of covering itself) and is ignored.
 */
internal fun bridgedLocaleStrings(values: Map<String, Any?>?): GopayLocaleStrings? {
  if (values == null) return null
  fun text(key: String) = values[key] as? String
  return GopayLocaleStrings(
    panLabel = text("panLabel") ?: return null,
    panPlaceholder = text("panPlaceholder") ?: return null,
    expLabel = text("expLabel") ?: return null,
    expPlaceholder = text("expPlaceholder") ?: return null,
    cvvLabel = text("cvvLabel") ?: return null,
    cvvPlaceholder = text("cvvPlaceholder") ?: return null,
    pay = text("pay") ?: return null,
    panErrorPattern = text("panErrorPattern") ?: return null,
    expErrorPattern = text("expErrorPattern") ?: return null,
    cvvErrorPattern = text("cvvErrorPattern") ?: return null,
    patternErrorMessage = text("patternErrorMessage") ?: return null,
    requiredErrorMessage = text("requiredErrorMessage") ?: return null
  )
}

/** A map from JS with string keys, or null for anything else. */
internal fun Any?.asStringMap(): Map<String, Any?>? =
  (this as? Map<*, *>)?.entries?.associate { (key, value) -> key.toString() to value }

/** `'hidden'`, `'live'` or `'onSubmit'`; anything else, or nothing, is the SDK's default `HIDDEN`. */
internal fun bridgedValidation(value: String?): PaymentCardFormValidationDisplay = when (value) {
  "live" -> PaymentCardFormValidationDisplay.LIVE
  "onSubmit" -> PaymentCardFormValidationDisplay.ON_SUBMIT
  else -> PaymentCardFormValidationDisplay.HIDDEN
}

/**
 * The largest values of the theme, those of `PAYMENT_CARD_FORM_THEME_LIMITS` in `src/cardForm.ts`
 * and of the iOS mapper.
 */
private object ThemeLimits {
  const val LENGTH = 1000.0
  const val FONT_SIZE = 200.0
  const val LINE_HEIGHT = 400.0
  const val LETTER_SPACING = 100.0
}

/**
 * Typed reads of a map from JS, null for a key that is missing, of another type or, for a number,
 * outside its range.
 */
private class BridgedValues(private val values: Map<String, Any?>) {
  /** JS numbers arrive as `Double`. */
  private fun number(key: String, range: ClosedFloatingPointRange<Double>): Double? =
    (values[key] as? Number)?.toDouble()?.takeIf { it.isFinite() && it in range }

  /** A length in dp, 0 to the limit. */
  fun length(key: String): Double? = number(key, 0.0..ThemeLimits.LENGTH)

  /** A font size in sp, above 0 up to the limit. */
  fun fontSize(key: String): Double? = number(key, 0.0..ThemeLimits.FONT_SIZE)?.takeIf { it > 0 }

  fun lineHeight(key: String): Double? = number(key, 0.0..ThemeLimits.LINE_HEIGHT)?.takeIf { it > 0 }

  fun letterSpacing(key: String): Double? =
    number(key, -ThemeLimits.LETTER_SPACING..ThemeLimits.LETTER_SPACING)

  /** A CSS weight, 100 to 900. */
  fun weight(key: String): Int? = number(key, 100.0..900.0)?.roundToInt()

  fun bool(key: String): Boolean? = values[key] as? Boolean

  fun string(key: String): String? = values[key] as? String

  /** `#RRGGBB` or `#RRGGBBAA`, the alpha last as in CSS. */
  fun color(key: String): Color? {
    val text = string(key) ?: return null
    if (!text.startsWith("#")) return null
    val hex = text.substring(1)
    if ((hex.length != 6 && hex.length != 8) || !hex.all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }) {
      return null
    }
    val rgba = hex.toLong(16).let { if (hex.length == 6) (it shl 8) or 0xFF else it }
    return Color(
      red = ((rgba shr 24) and 0xFF).toInt(),
      green = ((rgba shr 16) and 0xFF).toInt(),
      blue = ((rgba shr 8) and 0xFF).toInt(),
      alpha = (rgba and 0xFF).toInt()
    )
  }
}
