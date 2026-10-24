Pod::Spec.new do |s|
  s.name = 'BoltRuntime'
  s.version = '0.1.0'
  s.summary = 'On-device llama.cpp runtime for the BoltPocket local experiment'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'BoltPocket'
  s.homepage = 'https://github.com/ggml-org/llama.cpp'
  s.platforms = { :ios => '18.0' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.{h,mm,swift}'
  s.public_header_files = 'ios/BoltNativeBridge.h'
  s.vendored_libraries = 'ios/libboltruntime.a'
  s.frameworks = 'Foundation', 'Metal', 'MetalKit', 'Accelerate'
  s.libraries = 'c++'
  s.pod_target_xcconfig = { 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17', 'DEFINES_MODULE' => 'YES' }
end
