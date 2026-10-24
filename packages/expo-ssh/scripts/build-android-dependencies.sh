#!/usr/bin/env bash

set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly package_dir="$(cd "${script_dir}/.." && pwd)"
readonly native_source_dir="${package_dir}/android/src/main/c"

output_dir="${1:-${package_dir}/android/src/main/jniLibs}"
if [[ "${output_dir}" != /* ]]; then
  output_dir="$(pwd)/${output_dir}"
fi

readonly openssl_version="3.5.7"
readonly libssh2_version="1.11.1"
readonly android_api="24"
readonly openssl_source_sha256="a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8"
readonly libssh2_source_sha256="d9ec76cbe34db98eec3539fe2c899d26b0c837cb3eb466a56b0f109cabf658f7"

for required_tool in curl make perl shasum tar; do
  if ! command -v "${required_tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${required_tool}" >&2
    exit 69
  fi
done

android_sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "${android_sdk_root}" && "$(uname -s)" == "Darwin" ]]; then
  android_sdk_root="${HOME}/Library/Android/sdk"
fi
if [[ -z "${android_sdk_root}" || ! -d "${android_sdk_root}" ]]; then
  echo "Set ANDROID_SDK_ROOT to an installed Android SDK." >&2
  exit 69
fi
readonly android_sdk_root

android_ndk_root="${ANDROID_NDK_ROOT:-${ANDROID_NDK_HOME:-}}"
if [[ -z "${android_ndk_root}" && -d "${android_sdk_root}/ndk/27.1.12297006" ]]; then
  android_ndk_root="${android_sdk_root}/ndk/27.1.12297006"
fi
if [[ -z "${android_ndk_root}" ]]; then
  android_ndk_root="$(find "${android_sdk_root}/ndk" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort | tail -n 1)"
fi
if [[ -z "${android_ndk_root}" || ! -f "${android_ndk_root}/build/cmake/android.toolchain.cmake" ]]; then
  echo "Set ANDROID_NDK_ROOT to an installed Android NDK." >&2
  exit 69
fi
readonly android_ndk_root

case "$(uname -s)-$(uname -m)" in
  Darwin-*) host_tag="darwin-x86_64" ;;
  Linux-x86_64) host_tag="linux-x86_64" ;;
  *)
    echo "Unsupported Android build host: $(uname -s)-$(uname -m)" >&2
    exit 69
    ;;
esac
readonly host_tag
readonly llvm_bin="${android_ndk_root}/toolchains/llvm/prebuilt/${host_tag}/bin"
if [[ ! -x "${llvm_bin}/llvm-strip" ]]; then
  echo "Android NDK LLVM tools are missing from ${llvm_bin}." >&2
  exit 69
fi

cmake_bin="${CMAKE_BIN:-}"
if [[ -z "${cmake_bin}" ]]; then
  cmake_bin="$(find "${android_sdk_root}/cmake" -mindepth 2 -maxdepth 4 -type f -path '*/bin/cmake' -print 2>/dev/null | sort | tail -n 1)"
fi
if [[ -z "${cmake_bin}" ]]; then
  cmake_bin="$(command -v cmake || true)"
fi
if [[ -z "${cmake_bin}" || ! -x "${cmake_bin}" ]]; then
  echo "Install CMake 3.22.1 or set CMAKE_BIN." >&2
  exit 69
fi
readonly cmake_bin

jobs="${BOLTPOCKET_BUILD_JOBS:-}"
if [[ -z "${jobs}" ]]; then
  jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
fi
if [[ -z "${jobs}" || ! "${jobs}" =~ ^[1-9][0-9]*$ ]]; then
  jobs=4
fi
if (( jobs > 8 )); then jobs=8; fi
readonly jobs

requested_abis="${BOLTPOCKET_ANDROID_ABIS:-armeabi-v7a arm64-v8a x86 x86_64}"
read -r -a abis <<<"${requested_abis}"
if (( ${#abis[@]} == 0 )); then
  echo "BOLTPOCKET_ANDROID_ABIS must name at least one ABI." >&2
  exit 64
fi
for abi in "${abis[@]}"; do
  case "${abi}" in
    armeabi-v7a|arm64-v8a|x86|x86_64) ;;
    *)
      echo "Unsupported Android ABI: ${abi}" >&2
      exit 64
      ;;
  esac
done

temp_root="${TMPDIR:-/tmp}"
build_root="$(mktemp -d "${temp_root%/}/boltpocket-android-ssh.XXXXXX")"
readonly build_root
trap 'rm -rf "${build_root}"' EXIT

readonly downloads_dir="${build_root}/downloads"
readonly source_dir="${build_root}/source"
readonly staged_dir="${build_root}/jniLibs"
mkdir -p "${downloads_dir}" "${source_dir}" "${staged_dir}"

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

echo "Downloading checksum-pinned SSH sources..."
download_and_verify \
  "https://github.com/openssl/openssl/releases/download/openssl-${openssl_version}/openssl-${openssl_version}.tar.gz" \
  "${downloads_dir}/openssl.tar.gz" \
  "${openssl_source_sha256}"
download_and_verify \
  "https://www.libssh2.org/download/libssh2-${libssh2_version}.tar.gz" \
  "${downloads_dir}/libssh2.tar.gz" \
  "${libssh2_source_sha256}"
tar -xzf "${downloads_dir}/libssh2.tar.gz" -C "${source_dir}"
readonly libssh2_source="${source_dir}/libssh2-${libssh2_version}"

openssl_target_for_abi() {
  case "$1" in
    armeabi-v7a) echo "android-arm" ;;
    arm64-v8a) echo "android-arm64" ;;
    x86) echo "android-x86" ;;
    x86_64) echo "android-x86_64" ;;
  esac
}

export ANDROID_NDK_ROOT="${android_ndk_root}"
export PATH="${llvm_bin}:${PATH}"
export SOURCE_DATE_EPOCH=1735689600
export ZERO_AR_DATE=1
export LC_ALL=C
export TZ=UTC
export PERL_HASH_SEED=0
export PERL_PERTURB_KEYS=0

readonly openssl_install_prefix="/boltpocket-android-ssh/openssl-install"
readonly native_source_digest="$(
  cd "${package_dir}"
  shasum -a 256 \
    scripts/build-android-dependencies.sh \
    android/src/main/c/CMakeLists.txt \
    android/src/main/c/boltpocket_libssh2_jni.c | shasum -a 256 | awk '{print $1}'
)"

for abi in "${abis[@]}"; do
  echo "Building libssh2 ${libssh2_version} + OpenSSL ${openssl_version} for ${abi}..."
  abi_root="${build_root}/${abi}"
  openssl_source="${abi_root}/openssl-${openssl_version}"
  openssl_destdir="${abi_root}/openssl-dest"
  openssl_prefix="${openssl_destdir}${openssl_install_prefix}"
  native_build="${abi_root}/native-build"
  build_id="$(
    printf '%s\n' \
      "${abi}" \
      "${android_api}" \
      "${openssl_source_sha256}" \
      "${libssh2_source_sha256}" \
      "${native_source_digest}" | shasum -a 1 | awk '{print $1}'
  )"
  mkdir -p "${abi_root}" "${openssl_destdir}" "${staged_dir}/${abi}"
  tar -xzf "${downloads_dir}/openssl.tar.gz" -C "${abi_root}"

  openssl_log="${abi_root}/openssl.log"
  (
    cd "${openssl_source}"
    perl ./Configure \
      "$(openssl_target_for_abi "${abi}")" \
      -D__ANDROID_API__="${android_api}" \
      "-ffile-prefix-map=${build_root}=/boltpocket-android-ssh" \
      "-fdebug-prefix-map=${build_root}=/boltpocket-android-ssh" \
      no-apps no-docs no-module no-shared no-tests \
      --prefix="${openssl_install_prefix}" \
      --openssldir="${openssl_install_prefix}/ssl"
    make -j"${jobs}" build_libs
    make install_dev DESTDIR="${openssl_destdir}"
  ) >"${openssl_log}" 2>&1 || {
    tail -n 120 "${openssl_log}" >&2
    exit 1
  }

  native_log="${abi_root}/native.log"
  "${cmake_bin}" \
    -S "${native_source_dir}" \
    -B "${native_build}" \
    -DANDROID_ABI="${abi}" \
    -DANDROID_NATIVE_API_LEVEL="${android_api}" \
    -DANDROID_PLATFORM="android-${android_api}" \
    -DANDROID_STL=c++_static \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE="${android_ndk_root}/build/cmake/android.toolchain.cmake" \
    -DBOLTPOCKET_LIBSSH2_SOURCE="${libssh2_source}" \
    -DBOLTPOCKET_OPENSSL_ROOT="${openssl_prefix}" \
    -DBOLTPOCKET_BUILD_ID="${build_id}" \
    -DCMAKE_C_FLAGS="-ffile-prefix-map=${build_root}=/boltpocket-android-ssh -fdebug-prefix-map=${build_root}=/boltpocket-android-ssh" \
    >"${native_log}" 2>&1 || {
      tail -n 160 "${native_log}" >&2
      exit 1
    }
  "${cmake_bin}" --build "${native_build}" --target boltpocket_ssh --parallel "${jobs}" \
    >>"${native_log}" 2>&1 || {
      tail -n 200 "${native_log}" >&2
      exit 1
    }

  built_library="${native_build}/libboltpocket_ssh.so"
  if [[ ! -f "${built_library}" ]]; then
    echo "Native build did not produce ${built_library}." >&2
    exit 66
  fi
  "${llvm_bin}/llvm-strip" --strip-unneeded "${built_library}"
  install -m 0644 "${built_library}" "${staged_dir}/${abi}/libboltpocket_ssh.so"
done

mkdir -p "${output_dir}"
for abi in "${abis[@]}"; do
  mkdir -p "${output_dir}/${abi}"
  install -m 0644 \
    "${staged_dir}/${abi}/libboltpocket_ssh.so" \
    "${output_dir}/${abi}/libboltpocket_ssh.so.next"
  mv -f \
    "${output_dir}/${abi}/libboltpocket_ssh.so.next" \
    "${output_dir}/${abi}/libboltpocket_ssh.so"
done

echo "Built Android SSH transport:"
for abi in "${abis[@]}"; do
  shasum -a 256 "${output_dir}/${abi}/libboltpocket_ssh.so"
done
