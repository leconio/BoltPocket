#!/usr/bin/env bash

set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly package_dir="$(cd "${script_dir}/.." && pwd)"

output_path="${1:-${package_dir}/ios/vendor/ssh2.xcframework}"
if [[ "${output_path}" != /* ]]; then
  output_path="$(pwd)/${output_path}"
fi
if [[ "${output_path}" != */ssh2.xcframework ]]; then
  echo "Output must end in ssh2.xcframework: ${output_path}" >&2
  exit 64
fi

readonly openssl_version="3.5.7"
readonly openssl_ios_version="3.5.7.0"
readonly libssh2_version="1.11.1"
readonly cmake_version="4.4.2"
readonly ios_deployment_target="16.4"

readonly openssl_source_sha256="a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8"
readonly openssl_crypto_sha256="fac69cdc8a96173dfe97dab01778b5b9e7c7f11b3cb1c34a27fe3c85f04c3937"
readonly openssl_headers_sha256="1ce89763b60bcf862d4f24288fba354a7a82439a862e18986240ea960067f988"
readonly libssh2_source_sha256="d9ec76cbe34db98eec3539fe2c899d26b0c837cb3eb466a56b0f109cabf658f7"
readonly cmake_sha256="800fc86838e913fff969b499886c80baeb4ccfd00f0e39906b34aa334f39ab6c"

for required_tool in curl ditto rsync shasum tar xcodebuild; do
  if ! command -v "${required_tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${required_tool}" >&2
    exit 69
  fi
done

temp_root="${TMPDIR:-/tmp}"
build_root="$(mktemp -d "${temp_root%/}/boltpocket-ios-ssh.XXXXXX")"
readonly build_root
trap 'rm -rf "${build_root}"' EXIT

readonly downloads_dir="${build_root}/downloads"
readonly source_dir="${build_root}/source"
readonly openssl_dir="${build_root}/openssl"
readonly tools_dir="${build_root}/tools"
mkdir -p "${downloads_dir}" "${source_dir}" "${openssl_dir}" "${tools_dir}"

download_and_verify() {
  local url="$1"
  local destination="$2"
  local expected_sha256="$3"
  local actual_sha256

  curl --fail --location --retry 3 --silent --show-error \
    "${url}" --output "${destination}"
  actual_sha256="$(shasum -a 256 "${destination}" | awk '{print $1}')"
  if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
    echo "Checksum mismatch for ${url}" >&2
    echo "Expected: ${expected_sha256}" >&2
    echo "Actual:   ${actual_sha256}" >&2
    exit 65
  fi
}

download_and_verify \
  "https://github.com/openssl/openssl/releases/download/openssl-${openssl_version}/openssl-${openssl_version}.tar.gz" \
  "${downloads_dir}/openssl.tar.gz" \
  "${openssl_source_sha256}"
download_and_verify \
  "https://github.com/apotocki/openssl-iosx/releases/download/${openssl_ios_version}/crypto.xcframework.zip" \
  "${downloads_dir}/openssl-crypto.zip" \
  "${openssl_crypto_sha256}"
download_and_verify \
  "https://github.com/apotocki/openssl-iosx/releases/download/${openssl_ios_version}/include.zip" \
  "${downloads_dir}/openssl-headers.zip" \
  "${openssl_headers_sha256}"
download_and_verify \
  "https://www.libssh2.org/download/libssh2-${libssh2_version}.tar.gz" \
  "${downloads_dir}/libssh2.tar.gz" \
  "${libssh2_source_sha256}"

tar -xzf "${downloads_dir}/openssl.tar.gz" -C "${source_dir}"
tar -xzf "${downloads_dir}/libssh2.tar.gz" -C "${source_dir}"
ditto -x -k "${downloads_dir}/openssl-crypto.zip" "${openssl_dir}"
ditto -x -k "${downloads_dir}/openssl-headers.zip" "${openssl_dir}"

# openssl-iosx 3.5.7.0 ships the generated, target-compatible
# configuration.h, but its include archive omits many public headers. Overlay
# the complete headers from the matching signed OpenSSL source release.
rsync -a "${source_dir}/openssl-${openssl_version}/include/" \
  "${openssl_dir}/include/"

for required_header in configuration.h evp.h opensslconf.h rsa.h sha.h; do
  if [[ ! -f "${openssl_dir}/include/openssl/${required_header}" ]]; then
    echo "OpenSSL header assembly is incomplete: ${required_header}" >&2
    exit 66
  fi
done

cmake_bin="${CMAKE_BIN:-}"
if [[ -z "${cmake_bin}" ]]; then
  cmake_bin="$(command -v cmake || true)"
fi
if [[ -z "${cmake_bin}" ]]; then
  download_and_verify \
    "https://github.com/Kitware/CMake/releases/download/v${cmake_version}/cmake-${cmake_version}-macos-universal.tar.gz" \
    "${downloads_dir}/cmake.tar.gz" \
    "${cmake_sha256}"
  tar -xzf "${downloads_dir}/cmake.tar.gz" -C "${tools_dir}"
  cmake_bin="${tools_dir}/cmake-${cmake_version}-macos-universal/CMake.app/Contents/bin/cmake"
fi
if [[ ! -x "${cmake_bin}" ]]; then
  echo "CMake is not executable: ${cmake_bin}" >&2
  exit 69
fi

configure_libssh2() {
  local build_dir="$1"
  local sdk="$2"
  local architectures="$3"
  local crypto_library="$4"

  "${cmake_bin}" \
    -S "${source_dir}/libssh2-${libssh2_version}" \
    -B "${build_dir}" \
    -G Xcode \
    -DBUILD_EXAMPLES=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTING=OFF \
    -DCRYPTO_BACKEND=OpenSSL \
    -DENABLE_ZLIB_COMPRESSION=ON \
    -DCMAKE_OSX_SYSROOT="${sdk}" \
    -DCMAKE_OSX_ARCHITECTURES="${architectures}" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="${ios_deployment_target}" \
    -DCMAKE_C_FLAGS="-ffile-prefix-map=${build_root}=/boltpocket-ios-ssh -fdebug-prefix-map=${build_root}=/boltpocket-ios-ssh" \
    -DOPENSSL_INCLUDE_DIR="${openssl_dir}/include" \
    -DOPENSSL_CRYPTO_LIBRARY="${crypto_library}" \
    -DOPENSSL_USE_STATIC_LIBS=TRUE
}

readonly device_build_dir="${build_root}/build-device"
readonly simulator_build_dir="${build_root}/build-simulator"

configure_libssh2 \
  "${device_build_dir}" \
  iphoneos \
  arm64 \
  "${openssl_dir}/crypto.xcframework/ios-arm64/libcrypto.a"
configure_libssh2 \
  "${simulator_build_dir}" \
  iphonesimulator \
  'arm64;x86_64' \
  "${openssl_dir}/crypto.xcframework/ios-arm64_x86_64-simulator/libcrypto.a"

"${cmake_bin}" --build "${device_build_dir}" --config Release \
  --target libssh2_static --parallel 8
"${cmake_bin}" --build "${simulator_build_dir}" --config Release \
  --target libssh2_static --parallel 8

readonly staged_framework="${build_root}/ssh2.xcframework"
xcodebuild -create-xcframework \
  -library "${device_build_dir}/src/Release-iphoneos/libssh2.a" \
  -headers "${source_dir}/libssh2-${libssh2_version}/include" \
  -library "${simulator_build_dir}/src/Release-iphonesimulator/libssh2.a" \
  -headers "${source_dir}/libssh2-${libssh2_version}/include" \
  -output "${staged_framework}"

lipo "${staged_framework}/ios-arm64/libssh2.a" \
  -verify_arch arm64
lipo "${staged_framework}/ios-arm64_x86_64-simulator/libssh2.a" \
  -verify_arch arm64 x86_64

mkdir -p "$(dirname "${output_path}")"
readonly recovery_framework="${build_root}/previous-ssh2.xcframework"
if [[ -e "${output_path}" ]]; then
  ditto "${output_path}" "${recovery_framework}"
fi
rm -rf "${output_path}"
if ! ditto "${staged_framework}" "${output_path}"; then
  if [[ -e "${recovery_framework}" ]]; then
    ditto "${recovery_framework}" "${output_path}"
  fi
  exit 74
fi

echo "Built libssh2 ${libssh2_version} against OpenSSL ${openssl_version}:"
echo "  ${output_path}"
shasum -a 256 \
  "${output_path}/ios-arm64/libssh2.a" \
  "${output_path}/ios-arm64_x86_64-simulator/libssh2.a"
