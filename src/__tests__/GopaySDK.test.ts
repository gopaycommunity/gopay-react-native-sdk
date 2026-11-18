import { readFileSync } from 'fs';
import { join } from 'path';

const mockRequireNativeModule = jest.fn((_name: string) => ({ version: '3.0.0' }));

jest.mock('expo', () => ({
  NativeModule: class {},
  requireNativeModule: (name: string) => mockRequireNativeModule(name),
}));

const repoRoot = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('GopaySDK', () => {
  it('reads version from the native module that the Swift and Kotlin code register', () => {
    const { GopaySDK } = require('../index');
    const { NATIVE_MODULE_NAME } = require('../GopayReactNativeSDKModule');

    expect(GopaySDK.version).toBe('3.0.0');
    expect(mockRequireNativeModule).toHaveBeenCalledWith(NATIVE_MODULE_NAME);

    // A name that differs between JS and native only fails at runtime in the app, so check it here.
    const registered = `Name("${NATIVE_MODULE_NAME}")`;
    expect(read('ios/GopayReactNativeSDKModule.swift')).toContain(registered);
    expect(
      read('android/src/main/java/cz/gopay/reactnative/GopayReactNativeSDKModule.kt')
    ).toContain(registered);
  });
});
