import { act, StrictMode } from 'react';
import type { ViewStyle } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

/** The host element the mocked native view renders as. */
const NATIVE_VIEW = 'NativePaymentCardForm';
/** How many times the mocked native view was mounted, as a native view would be created. */
let mockNativeViewMounts = 0;
const mockRequireNativeView = jest.fn((_module: string) => {
  const { createElement, useEffect } = require('react') as typeof import('react');
  return function MockNativePaymentCardForm(props: object) {
    useEffect(() => {
      mockNativeViewMounts += 1;
    }, []);
    return createElement(NATIVE_VIEW, props);
  };
});

jest.mock('expo', () => ({
  NativeModule: class {},
  requireNativeModule: () => ({}),
  requireNativeView: (module: string) => mockRequireNativeView(module),
}));

// Required, not imported: imports are hoisted above the mock factory's variables.
const { PaymentCardForm } = require('../index') as typeof import('../index');
const { NATIVE_MODULE_NAME } =
  require('../GopayReactNativeSDKModule') as typeof import('../GopayReactNativeSDKModule');
const { StyleSheet } = require('react-native') as typeof import('react-native');
const requiredViews = mockRequireNativeView.mock.calls.map(([module]) => module);

let root: Root;
let warn: jest.SpyInstance;

beforeEach(() => {
  root = createRoot();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  warn.mockRestore();
});

const render = async (element: React.ReactElement) => {
  await act(async () => root.render(element));
};

/** The one native view rendered. */
const nativeView = (): TestInstance => {
  const found = root.container.queryAll((node) => node.type === NATIVE_VIEW);
  expect(found).toHaveLength(1);
  return found[0]!;
};

const style = (): ViewStyle => StyleSheet.flatten(nativeView().props.style) ?? {};

/** React Native reporting the layout of the native view. */
const layOut = async (width: number) => {
  await act(async () =>
    nativeView().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } })
  );
};

/** The native view reporting the height of its form. */
const reportHeight = async (height: number) => {
  await act(async () => nativeView().props.onFormHeightChange({ nativeEvent: { height } }));
};

describe('PaymentCardForm', () => {
  it('is the view of the one native module', () => {
    expect(requiredViews).toEqual([NATIVE_MODULE_NAME]);
  });

  it('passes the formId to the native view as it is', async () => {
    await render(<PaymentCardForm formId=" Checkout Form " />);
    expect(nativeView().props.formId).toBe(' Checkout Form ');

    await render(<PaymentCardForm formId="other" />);
    expect(nativeView().props.formId).toBe('other');
  });

  it('keeps the native view mounted when the formId changes, so the typed card stays', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    const mounts = mockNativeViewMounts;
    expect(mounts).toBeGreaterThan(0);

    await render(<PaymentCardForm formId="other" />);
    expect(nativeView().props.formId).toBe('other');
    // A remount (e.g. key={formId}) would wipe the card; the native SDK moves it to the new id.
    expect(mockNativeViewMounts).toBe(mounts);
  });

  it('has no height of its own until the native view reports one', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    expect(style().height).toBeUndefined();
  });

  it('takes the height the native view reports, and each new one', async () => {
    await render(<PaymentCardForm formId="checkout" style={{ marginTop: 8 }} />);
    await reportHeight(212.5);
    expect(style()).toEqual({ height: 212.5, marginTop: 8 });

    await reportHeight(240);
    expect(style().height).toBe(240);
  });

  it('keeps a height the style sets over the reported one', async () => {
    await render(<PaymentCardForm formId="checkout" style={{ height: 300 }} />);
    await reportHeight(212.5);
    expect(style().height).toBe(300);
  });

  it('keeps a height inside an array of styles over the reported one', async () => {
    await render(<PaymentCardForm formId="checkout" style={[{ marginTop: 8 }, { height: 300 }]} />);
    await reportHeight(212.5);
    expect(style()).toEqual({ height: 300, marginTop: 8 });
  });

  it('warns once in development when its parent gives it no width', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    await layOut(0);
    await layOut(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('"checkout" has no width');
  });

  it('does not warn about a form that has a width', async () => {
    await render(<PaymentCardForm formId="checkout" />);
    await layOut(390);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about no width once per form in Strict Mode too', async () => {
    await render(
      <StrictMode>
        <PaymentCardForm formId="checkout" />
      </StrictMode>
    );
    await layOut(0);
    await layOut(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns in development when formId is not a string', async () => {
    const Untyped = PaymentCardForm as unknown as React.ComponentType<{ formId?: unknown }>;
    await render(<Untyped />);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('needs a formId string'));
  });

  it('renders one native view in Strict Mode and keeps the reported height', async () => {
    await render(
      <StrictMode>
        <PaymentCardForm formId="checkout" />
      </StrictMode>
    );
    await reportHeight(180);
    expect(nativeView().props.formId).toBe('checkout');
    expect(style().height).toBe(180);
  });
});
