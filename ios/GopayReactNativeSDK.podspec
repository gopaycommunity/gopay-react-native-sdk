require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'GopayReactNativeSDK'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  # GopaySDK declares no tvOS, so neither does this pod.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: package['repository']['url'], tag: s.version.to_s }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # The native GoPay iOS SDK from its public GitHub mirror through Swift Package Manager.
  # `spm_dependency` comes from React Native's react_native_pods.rb. The version is
  # `gopayNativeSdkVersion` in package.json, shared with the Android build.
  spm_dependency(s,
    url: 'https://github.com/gopaycommunity/gopay-ios-sdk',
    requirement: { kind: 'exactVersion', version: package['gopayNativeSdkVersion'] },
    products: ['GopaySDK']
  )

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
