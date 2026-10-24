Pod::Spec.new do |s|
  s.name = 'BoltPocketLibssh2'
  s.version = '1.11.1.0'
  s.summary = 'Repository-built libssh2 XCFramework for the BoltPocket iOS SSH transport.'
  s.homepage = 'https://libssh2.org/'
  s.license = { :type => 'BSD-3-Clause' }
  s.author = { 'libssh2 contributors' => 'https://libssh2.org/' }
  s.platforms = { :ios => '13.4' }
  s.static_framework = true
  s.source = { :path => '.' }
  s.preserve_paths = 'vendor/ssh2.xcframework'
  s.vendored_frameworks = 'vendor/ssh2.xcframework'
  s.dependency 'BoltPocketOpenSSLCrypto', '3.5.7.0'
end
