import ExpoModulesCore
import GopaySDK
import SwiftUI

/// Hosts the SDK's SwiftUI `PaymentCardForm` as it is, in a `UIHostingController` attached to the
/// nearest view controller, so that SwiftUI gets its lifecycle (focus, keyboard, `onAppear` and
/// `onDisappear`, which register and wipe the form in the SDK). A new `formId` on a form that is on
/// screen needs no new `onAppear`: the SDK moves the registration and the card to it itself.
///
/// React Native gives the width; the form's height is measured here and reported to JS through
/// `onFormHeightChange`, which the JS component applies as the view's height. Nothing about the
/// card crosses the bridge: the form keeps it and hands it to the SDK itself. Besides the height,
/// only two booleans leave the form: its validity (`onFormValidityChange`) and, while JS drives
/// it, the SDK changing the submit flag (`onFormSubmitAttemptedChange`).
///
/// A new prop goes into the same SwiftUI `PaymentCardForm`, at the same place in the hierarchy, so
/// SwiftUI keeps its state: the card typed into the form stays whatever prop changes.
final class PaymentCardFormView: ExpoView {
  /// Internal to the JS component, not a public prop.
  let onFormHeightChange = EventDispatcher()
  /// Internal: the form's validity, each time it changes.
  let onFormValidityChange = EventDispatcher()
  /// Internal: the SDK raising or lowering the submit flag that JS drives.
  let onFormSubmitAttemptedChange = EventDispatcher()

  private let model = HostedCardFormModel()
  private let hostingController: UIHostingController<HostedCardForm>

  /// The `formId` the form registers under in the SDK. The form is created when it arrives; when
  /// it changes later, the SDK moves the registration and the typed card to the new id itself.
  var formId: String? {
    get { model.formId }
    set { model.formId = newValue }
  }

  /// The theme JS sent; `nil` is the SDK's default theme.
  func setTheme(_ values: [String: Any]?) {
    model.theme = PaymentCardFormTheme(bridged: values)
  }

  func setLocale(_ locale: String?) {
    model.locale = locale
  }

  /// The strings JS sent; `nil`, or an incomplete set, leaves the form to its locale.
  func setLocaleStrings(_ values: [String: Any]?) {
    model.localeStrings = GopayLocaleStrings(bridged: values)
  }

  func setValidation(_ validation: String?) {
    model.validation = PaymentCardFormValidationDisplay(bridged: validation)
  }

  func setAllowsAutofill(_ allowsAutofill: Bool?) {
    model.allowsAutofill = allowsAutofill ?? false
  }

  /// The submit flag as JS drives it; `nil` leaves it to the form.
  func setSubmitAttempted(_ attempted: Bool?) {
    model.setHostSubmitAttempted(attempted)
  }

  /// The number of the last `onFormSubmitAttemptedChange` JS has answered.
  func setSubmitAttemptedAck(_ ack: Int?) {
    model.answer(ack ?? 0)
  }

  required init(appContext: AppContext? = nil) {
    hostingController = UIHostingController(rootView: HostedCardForm(model: model))
    super.init(appContext: appContext)
    hostingController.view.backgroundColor = .clear
    // A form taller than the height React Native gives (the first frame, before JS applies the
    // reported height, or a smaller height in style) is cut off below, as on Android. The hosting
    // view clips, not this one: React Native manages this view's clipping from `overflow` and
    // draws `boxShadow`, `outline` and the shadow outside its bounds.
    hostingController.view.clipsToBounds = true
    // React Native places the view; the safe area is the screen's business, not the form's.
    hostingController.safeAreaRegions = []
    addSubview(hostingController.view)
    model.onHeight = { [weak self] height in
      self?.onFormHeightChange(["height": Double(height)])
    }
    model.onValidity = { [weak self] isValid in
      self?.onFormValidityChange(["isValid": isValid])
    }
    model.onSubmitAttempted = { [weak self] attempted, seq in
      self?.onFormSubmitAttemptedChange(["attempted": attempted, "seq": seq])
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // At least a point high: SwiftUI lays out nothing in a view without area, so a form React Native
    // starts at a height of 0 would never measure the height that JS needs to apply. That point is
    // transparent rather than hidden, so that SwiftUI still lays the form out and measures it.
    hostingController.view.frame = CGRect(x: 0, y: 0, width: bounds.width, height: max(bounds.height, 1))
    hostingController.view.alpha = bounds.height > 0 ? 1 : 0
    model.width = bounds.width
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    attachToClosestViewController()
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    attachToClosestViewController()
  }

  /// Makes the hosting controller a child of the view controller the view is in now, moving it
  /// when the view went to another one, and detaches it when the view leaves the window.
  private func attachToClosestViewController() {
    let parent = window == nil ? nil : closestViewController()
    guard hostingController.parent !== parent else { return }
    if hostingController.parent != nil {
      hostingController.willMove(toParent: nil)
      hostingController.removeFromParent()
    }
    if let parent {
      parent.addChild(hostingController)
      hostingController.didMove(toParent: parent)
    }
  }

  private func closestViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let viewController = current as? UIViewController { return viewController }
      responder = current.next
    }
    return window?.rootViewController
  }
}

private final class HostedCardFormModel: ObservableObject {
  @Published var formId: String?
  @Published var theme = PaymentCardFormTheme()
  @Published var locale: String?
  @Published var localeStrings: GopayLocaleStrings?
  @Published var validation = PaymentCardFormValidationDisplay.hidden
  @Published var allowsAutofill = false
  /// The submit flag JS drives, `nil` while it leaves the flag to the form.
  @Published private(set) var hostSubmitAttempted: Bool?
  /// The value reported last, until JS answers that report; `nil` when JS has answered every one.
  /// The form reads it rather than ``hostSubmitAttempted``, which may still be the value from before
  /// the report, so a second change the SDK makes before JS answers is not lost.
  @Published private var pendingSubmitAttempted: Bool?
  /// How many changes of the flag the view has reported, and the last of them JS has answered.
  private var reportedSubmitSeq = 0
  private var answeredSubmitSeq = 0

  /// Told the form's validity whenever it changes, and the first time the form writes it.
  var onValidity: ((Bool) -> Void)?
  /// Told the flag, with the number of the report, whenever the SDK changes it while JS drives it.
  var onSubmitAttempted: ((Bool, Int) -> Void)?

  func setHostSubmitAttempted(_ attempted: Bool?) {
    hostSubmitAttempted = attempted
    if attempted == nil { pendingSubmitAttempted = nil }
  }

  /// JS has answered the reports up to `seq`: from the last one on, the value JS sends is the flag.
  func answer(_ seq: Int) {
    answeredSubmitSeq = max(answeredSubmitSeq, seq)
    if answeredSubmitSeq >= reportedSubmitSeq { pendingSubmitAttempted = nil }
  }
  /// The validity last told, `nil` before the form first wrote it. The form writes it on every
  /// edit; JS hears only the changes.
  private var reportedValidity: Bool?

  /// What the form writes its validity into. Not published: the form writes it while SwiftUI
  /// updates the view, and nothing on screen depends on it.
  var isValid: Binding<Bool> {
    Binding(
      get: { [weak self] in self?.reportedValidity ?? false },
      set: { [weak self] isValid in
        guard let self, self.reportedValidity != isValid else { return }
        self.reportedValidity = isValid
        self.onValidity?(isValid)
      }
    )
  }

  /// The flag for the form while JS drives it, `nil` otherwise, which leaves it to the form. The
  /// form reads the value JS sent, or the value reported last until JS answers it; when the SDK
  /// changes the flag, the form writes it here, which tells JS. Once JS answers, the value it sends
  /// is the flag again, as a binding the host does not store behaves. The form writes only a value
  /// that differs from what it reads, so JS sending the reported value back raises no new event.
  var submitAttempted: Binding<Bool>? {
    guard hostSubmitAttempted != nil else { return nil }
    return Binding(
      get: { [weak self] in self?.pendingSubmitAttempted ?? self?.hostSubmitAttempted ?? false },
      set: { [weak self] attempted in self?.report(attempted) }
    )
  }

  private func report(_ attempted: Bool) {
    reportedSubmitSeq += 1
    pendingSubmitAttempted = attempted
    onSubmitAttempted?(attempted, reportedSubmitSeq)
  }
  /// Told the form's height whenever it changes by more than half a point.
  var onHeight: ((CGFloat) -> Void)?
  /// The width React Native gives the view. Nothing is reported while it is 0: the form then has
  /// no layout worth the name (it overflows to its own minimum), as on Android. The parent gives
  /// the width.
  var width: CGFloat = 0 {
    didSet { report() }
  }
  /// The form's height and the width SwiftUI measured it at.
  private var lastMeasured = FormSize()
  private var reportedHeight: CGFloat = 0

  func measured(_ size: FormSize) {
    lastMeasured = size
    report()
  }

  /// Reports only a height measured at the width the view has now: after the width comes back
  /// from 0, the height measured at 0 waits for SwiftUI to measure again at the new width, which
  /// always changes the preference, since the width is part of it.
  private func report() {
    // Sub-point changes would loop: JS sets the height, SwiftUI measures again, and so on.
    guard width > 0, abs(lastMeasured.width - width) < 0.5, lastMeasured.height > 0,
          abs(lastMeasured.height - reportedHeight) > 0.5 else { return }
    reportedHeight = lastMeasured.height
    onHeight?(lastMeasured.height)
  }
}

/// The SDK's form with the props JS set, at the width React Native gives and the height it needs
/// at that width, pinned to the top of a taller view.
private struct HostedCardForm: View {
  @ObservedObject var model: HostedCardFormModel

  var body: some View {
    VStack(spacing: 0) {
      if let formId = model.formId {
        PaymentCardForm(
          theme: model.theme,
          locale: model.locale,
          localeStrings: model.localeStrings,
          validation: model.validation,
          submitAttempted: model.submitAttempted,
          isValid: model.isValid,
          formId: formId,
          allowsAutofill: model.allowsAutofill
        )
          .fixedSize(horizontal: false, vertical: true)
          .background(
            GeometryReader { proxy in
              Color.clear.preference(key: FormSizeKey.self, value: FormSize(height: proxy.size.height))
            }
          )
      }
    }
    // minWidth 0: a view narrower than the form's own minimum still reads as its own width below, so
    // the height measured at it is reported. minHeight 0: a view lower than the form keeps the form's
    // top in place rather than centring it.
    .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity, alignment: .top)
    // The width the form is laid out at, beside its height.
    .background(
      GeometryReader { proxy in
        Color.clear.preference(key: FormSizeKey.self, value: FormSize(width: proxy.size.width))
      }
    )
    .onPreferenceChange(FormSizeKey.self) { model.measured($0) }
  }
}

/// The width of the hosted view and the height of the form in it.
private struct FormSize: Equatable {
  var width: CGFloat = 0
  var height: CGFloat = 0
}

/// Each part the largest reported: one view sets the width, another the height, and SwiftUI also
/// reduces the default value of views that set neither.
private struct FormSizeKey: PreferenceKey {
  static var defaultValue = FormSize()
  static func reduce(value: inout FormSize, nextValue: () -> FormSize) {
    let next = nextValue()
    value = FormSize(width: max(value.width, next.width), height: max(value.height, next.height))
  }
}
