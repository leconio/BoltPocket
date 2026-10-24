require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'BoltPocketQuickJs'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'BoltPocket'
  s.homepage       = 'https://github.com/aside0/BoltPocket'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.{h,mm,swift}', 'cpp/**/*.{h,c,cpp}'
  s.exclude_files = 'cpp/tests/**/*'
  s.public_header_files = 'ios/**/*.h'
  s.compiler_flags = '-Wno-unused-parameter -Wno-c99-extensions -Wno-c++20-extensions -Wno-shorten-64-to-32'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) CONFIG_VERSION=\"boltpocket-vendored-1.0.1\"',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/cpp" "$(PODS_TARGET_SRCROOT)/cpp/quickjs"',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17'
  }
end
