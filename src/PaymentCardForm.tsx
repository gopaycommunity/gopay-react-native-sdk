import { requireNativeView } from 'expo';
import { useCallback, useRef, useState, type ComponentType } from 'react';
import type { LayoutChangeEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

import { NATIVE_MODULE_NAME } from './GopayReactNativeSDKModule';

export interface PaymentCardFormProps {
  /**
   * Identifies the form to `GopaySDK.submitCardForm`, `submitCardFormWithMetadata` and
   * `clearCardFormData`. Keep one form on screen per `formId`. Required, unlike in the native
   * SDKs, where a missing id means the form that was active last. Changing it on a mounted form
   * moves the form and the card typed into it to the new id.
   */
  formId: string;
  /**
   * Laid out by the parent, which must give the form its width. The height is the form's own,
   * measured natively, unless the style sets one: then that height applies and the parent
   * answers for it.
   */
  style?: StyleProp<ViewStyle>;
}

/** The native view's props: the public ones and the height it reports. */
interface NativePaymentCardFormProps {
  formId: string;
  style: StyleProp<ViewStyle>;
  /** Not public: the height the native form needs at the width it was given, in points. */
  onFormHeightChange: (event: NativeSyntheticEvent<{ height: number }>) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}

/** The view `View(...)` registers in the native module `GopayReactNativeSDK`. */
const NativePaymentCardForm: ComponentType<NativePaymentCardFormProps> =
  requireNativeView(NATIVE_MODULE_NAME);

/** Whether the development warning about a `formId` that is not a string was given. */
let warnedAboutFormId = false;

/** Development only: a `formId` from untyped JS that is not a string, told once per app run. */
function checkFormId(formId: unknown) {
  if (!__DEV__ || typeof formId === 'string' || warnedAboutFormId) return;
  warnedAboutFormId = true;
  console.warn(
    `PaymentCardForm needs a formId string, got ${typeof formId}: the same id goes to ` +
      'GopaySDK.submitCardForm.'
  );
}

/**
 * The card form of the native GoPay SDK, `PaymentCardForm` on iOS (SwiftUI) and Android (Compose),
 * hosted as it is. What the user types stays native: JS submits the form by its `formId` and
 * receives only the JWE (`GopaySDK.submitCardForm`).
 *
 * Unmounting the form drops the card. On Android the form keeps the app's window out of
 * screenshots (`FLAG_SECURE`) while it is mounted, except in a debuggable build.
 */
export function PaymentCardForm({ formId, style }: PaymentCardFormProps) {
  const [measuredHeight, setMeasuredHeight] = useState<number>();
  const onFormHeightChange = useCallback(
    (event: NativeSyntheticEvent<{ height: number }>) =>
      setMeasuredHeight(event.nativeEvent.height),
    []
  );

  // Development only: a form its parent gives no width (under `alignItems: 'center'`, in a row
  // without a width) measures no height and stays invisible. Told once per form, from the layout
  // event rather than an effect, so Strict Mode does not tell it twice.
  const warnedAboutWidth = useRef(false);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (event.nativeEvent.layout.width > 0 || warnedAboutWidth.current) return;
      warnedAboutWidth.current = true;
      console.warn(
        `PaymentCardForm "${formId}" has no width. Its parent must give it one, e.g. with ` +
          "alignSelf: 'stretch' or a width in style; until then the form has no height either."
      );
    },
    [formId]
  );
  checkFormId(formId);

  return (
    // No `key={formId}` on purpose: the native SDK moves the form and its card to a new formId
    // itself, while a key would remount the form and drop the card.
    <NativePaymentCardForm
      formId={formId}
      onFormHeightChange={onFormHeightChange}
      onLayout={__DEV__ ? onLayout : undefined}
      // The integrator's style last, so that a height in it wins over the measured one.
      style={[{ height: measuredHeight }, style]}
    />
  );
}
