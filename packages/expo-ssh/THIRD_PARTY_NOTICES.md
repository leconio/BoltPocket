# Third-party notices

`@boltpocket/expo-ssh` includes or links the following third-party software:

- **libssh2 1.11.1**, BSD 3-Clause license. Source and license:
  <https://libssh2.org/>
- **OpenSSL 3.5.7 LTS**, Apache License 2.0. Source and license:
  <https://www.openssl.org/source/>
- **NMSSH**, MIT license. Source and license:
  <https://github.com/aanah0/NMSSH>

The repository-built Android shared objects and iOS libssh2 XCFramework contain
unmodified libssh2 library code compiled against checksum-pinned OpenSSL crypto
libraries. The exact official inputs and build procedures are recorded in
`scripts/build-android-dependencies.sh` and
`scripts/build-ios-dependencies.sh`.
