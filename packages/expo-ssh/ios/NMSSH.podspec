Pod::Spec.new do |s|
  s.name = 'NMSSH'
  s.version = '2.3.1.2'
  s.summary = 'NMSSH sources linked against architecture-correct BoltPocket XCFrameworks.'
  s.homepage = 'https://github.com/aanah0/NMSSH'
  s.license = { :type => 'MIT' }
  s.authors = {
    'Christoffer Lejdborg' => 'hello@9muses.se',
    'Tommaso Madonia' => 'tommaso@madonia.me'
  }
  s.platforms = { :ios => '13.4' }
  s.requires_arc = true
  s.source = {
    :git => 'https://github.com/aanah0/NMSSH.git',
    :commit => 'fdb2ee4f24ed5d6f2a6c213a3989026caf076d63'
  }

  s.source_files = 'NMSSH/**/*.{h,m}'
  s.public_header_files = [
    'NMSSH/*.h',
    'NMSSH/Protocols/*.h',
    'NMSSH/Config/NMSSHLogger.h'
  ]
  s.private_header_files = [
    'NMSSH/Config/NMSSH+Protected.h',
    'NMSSH/Config/socket_helper.h'
  ]
  s.libraries = 'z'
  s.frameworks = 'CFNetwork'
  s.pod_target_xcconfig = {
    'OTHER_LDFLAGS' => '$(inherited) -ObjC'
  }

  s.dependency 'BoltPocketLibssh2', '1.11.1.0'
end
