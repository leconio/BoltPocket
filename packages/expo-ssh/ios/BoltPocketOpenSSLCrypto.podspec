Pod::Spec.new do |s|
  s.name = 'BoltPocketOpenSSLCrypto'
  s.version = '3.5.7.0'
  s.summary = 'Pinned OpenSSL crypto XCFramework for the BoltPocket iOS SSH transport.'
  s.homepage = 'https://github.com/apotocki/openssl-iosx'
  s.license = { :type => 'Apache-2.0' }
  s.author = { 'Alexander Pototskiy' => 'alex.a.potocki@gmail.com' }
  s.platforms = { :ios => '13.4' }
  s.static_framework = true
  s.source = {
    :http => 'https://github.com/apotocki/openssl-iosx/releases/download/3.5.7.0/crypto.xcframework.zip',
    :sha256 => 'fac69cdc8a96173dfe97dab01778b5b9e7c7f11b3cb1c34a27fe3c85f04c3937'
  }
  s.vendored_frameworks = 'crypto.xcframework'
end
