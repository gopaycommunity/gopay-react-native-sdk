package cz.gopay.reactnative

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import android.view.View
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.platform.findViewTreeCompositionContext
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.savedstate.findViewTreeSavedStateRegistryOwner
import cz.gopay.sdk.ui.PaymentCardForm
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

/**
 * Hosts the SDK's Compose `PaymentCardForm` as it is, in a [ComposeView] that composes with the
 * lifecycle and saved state owners of its window, the Activity's or the dialog's (see
 * [onAttachedToWindow]); the form needs no ViewModelStore. The composition is disposed when the
 * view leaves the window, which unregisters the form in the SDK, drops its card and releases
 * the `FLAG_SECURE` it put on the window.
 *
 * React Native gives the width; the form's height is measured here and reported to JS through
 * `onFormHeightChange`, which the JS component applies as the view's height. Nothing about the
 * card crosses the bridge: the form keeps it and hands it to the SDK itself.
 */
class PaymentCardFormView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** Internal to the JS component, not a public prop. */
  private val onFormHeightChange by EventDispatcher()

  /** Measured and laid out by Android, so a change of the Compose content reaches the layout. */
  override val shouldUseAndroidLayout: Boolean = true

  /**
   * The `formId` the form registers under in the SDK. The form is composed when it arrives; when it
   * changes later, the SDK moves the registration and the typed card to the new id itself.
   */
  var formId: String? by mutableStateOf(null)

  /** The last height reported to JS, in dp. */
  private var reportedHeight = 0f

  private val composeView = ComposeView(context).also { view ->
    view.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
    view.setContent {
      formId?.let { PaymentCardForm(formId = it) }
    }
  }

  /** Whether the debug log has been told that the form cannot compose here. */
  private var loggedNoOwners = false

  init {
    orientation = VERTICAL
    addView(composeView, formLayoutParams())
  }

  private fun formLayoutParams() = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)

  /**
   * Measures the form at the width React Native gives and an unbounded height. React Native
   * starts the view at a height of 0 until JS applies the height reported here, and a
   * `ComposeView` measured against 0 would never produce one.
   */
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val width = MeasureSpec.getSize(widthMeasureSpec)
    // A ComposeView measured without a window throws, and React Native measures views that are not
    // in one: a layout posted before the Activity was recreated (a font size change) runs on the
    // detached view. It keeps the size it has; attached again, the ComposeView composes, asks for
    // a layout and this runs with it.
    if (!composeView.isAttachedToWindow) {
      setMeasuredDimension(width, measuredHeight)
      return
    }
    if (width <= 0) {
      super.onMeasure(widthMeasureSpec, heightMeasureSpec)
      return
    }
    composeView.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
    )
    val contentHeight = composeView.measuredHeight
    setMeasuredDimension(width, contentHeight)
    reportHeight(contentHeight / resources.displayMetrics.density)
  }

  private fun reportHeight(height: Float) {
    // Sub-dp changes would loop: JS sets the height, Android measures again, and so on.
    if (height <= 0f || abs(height - reportedHeight) <= 0.5f) return
    reportedHeight = height
    onFormHeightChange(mapOf("height" to height.toDouble()))
  }

  /**
   * Leaves the form out, with one sentence in the debug log, where Compose would throw instead of
   * composing it. Compose needs, as of Compose UI 1.8:
   * - a lifecycle and a saved state owner found from the `ComposeView` up the tree, which
   *   `AndroidComposeView` checks when it is attached;
   * - a composition context: one an ancestor view carries, or else the window recomposer, which
   *   Compose creates on the child of `android.R.id.content` (or the window's root) and ties to the
   *   lifecycle owner found from there up, not from this view.
   * The Activity window of a React Native app has all of them on its decor view, and so does the
   * dialog window of a React Native `Modal`. This view sets no owner, neither on itself nor on a
   * window that is not its own.
   *
   * Runs before the children are attached, so adding or removing the `ComposeView` here attaches
   * it once or not at all.
   */
  override fun onAttachedToWindow() {
    val canCompose = findViewTreeLifecycleOwner() != null &&
      findViewTreeSavedStateRegistryOwner() != null &&
      (findViewTreeCompositionContext() != null || contentChild().findViewTreeLifecycleOwner() != null)
    if (canCompose && composeView.parent == null) {
      addView(composeView, formLayoutParams())
    } else if (!canCompose && composeView.parent != null) {
      removeView(composeView)
      if (!loggedNoOwners && context.isDebuggable()) {
        loggedNoOwners = true
        Log.w(TAG, "PaymentCardForm is not shown: its window has no lifecycle owner to compose it in.")
      }
    }
    super.onAttachedToWindow()
  }

  /** Where Compose creates the window recomposer: the child of `android.R.id.content`, else the root. */
  private fun contentChild(): View {
    var self: View = this
    var parent = self.parent
    while (parent is View) {
      if (parent.id == android.R.id.content) return self
      self = parent
      parent = self.parent
    }
    return self
  }

  private companion object {
    const val TAG = "GopayReactNativeSDK"
  }
}

private fun Context.isDebuggable(): Boolean =
  (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
