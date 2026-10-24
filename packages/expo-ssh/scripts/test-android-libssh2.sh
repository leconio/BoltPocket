#!/usr/bin/env bash

set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly package_dir="$(cd "${script_dir}/.." && pwd)"
readonly android_dir="${package_dir}/android"
readonly libraries_dir="${android_dir}/src/main/jniLibs"
readonly android_api="24"
readonly openssl_source_sha256="a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8"
readonly libssh2_source_sha256="d9ec76cbe34db98eec3539fe2c899d26b0c837cb3eb466a56b0f109cabf658f7"
readonly native_source_digest="$(
  cd "${package_dir}"
  shasum -a 256 \
    scripts/build-android-dependencies.sh \
    android/src/main/c/CMakeLists.txt \
    android/src/main/c/boltpocket_libssh2_jni.c | shasum -a 256 | awk '{print $1}'
)"

if rg -n -i '(^|[^a-z])(jsch|com\.jcraft|mwiede)([^a-z]|$)' \
  "${android_dir}/build.gradle" "${android_dir}/src/main"; then
  echo "Android SSH still references JSch." >&2
  exit 1
fi

android_sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "${android_sdk_root}" && "$(uname -s)" == "Darwin" ]]; then
  android_sdk_root="${HOME}/Library/Android/sdk"
fi
android_ndk_root="${ANDROID_NDK_ROOT:-${ANDROID_NDK_HOME:-}}"
if [[ -z "${android_ndk_root}" && -d "${android_sdk_root}/ndk/27.1.12297006" ]]; then
  android_ndk_root="${android_sdk_root}/ndk/27.1.12297006"
fi
if [[ -z "${android_ndk_root}" && -n "${android_sdk_root}" ]]; then
  android_ndk_root="$(find "${android_sdk_root}/ndk" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort | tail -n 1)"
fi
case "$(uname -s)" in
  Darwin) host_tag="darwin-x86_64" ;;
  Linux) host_tag="linux-x86_64" ;;
  *) host_tag="" ;;
esac
readelf_bin="${android_ndk_root}/toolchains/llvm/prebuilt/${host_tag}/bin/llvm-readelf"
if [[ -z "${android_ndk_root}" || ! -x "${readelf_bin}" ]]; then
  echo "Android NDK llvm-readelf is required for native SSH verification." >&2
  exit 69
fi

for abi in armeabi-v7a arm64-v8a x86 x86_64; do
  library="${libraries_dir}/${abi}/libboltpocket_ssh.so"
  expected_build_id="$(
    printf '%s\n' \
      "${abi}" \
      "${android_api}" \
      "${openssl_source_sha256}" \
      "${libssh2_source_sha256}" \
      "${native_source_digest}" | shasum -a 1 | awk '{print $1}'
  )"
  if [[ ! -f "${library}" ]]; then
    echo "Missing Android SSH library for ${abi}." >&2
    exit 1
  fi
  if ! "${readelf_bin}" --dyn-syms --wide "${library}" | \
      rg 'Java_dev_boltpocket_app_ssh_BoltPocketLibssh2Native_transportVersion' >/dev/null; then
    echo "JNI entry points are missing for ${abi}." >&2
    exit 1
  fi
  if "${readelf_bin}" --dynamic --wide "${library}" | \
      rg 'NEEDED.*(libcrypto|libssl|libssh2)' >/dev/null; then
    echo "${abi} unexpectedly depends on a non-platform shared crypto or SSH library." >&2
    exit 1
  fi
  actual_build_id="$(
    "${readelf_bin}" --notes "${library}" | \
      awk '/Build ID:/ { print $3; exit }'
  )"
  if [[ "${actual_build_id}" != "${expected_build_id}" ]]; then
    echo "${abi} is stale or has a non-reproducible native Build ID." >&2
    exit 1
  fi
  if "${readelf_bin}" --program-headers --wide "${library}" | \
      awk '$1 == "LOAD" && $NF != "0x4000" { found = 1 } END { exit found ? 0 : 1 }'; then
    echo "${abi} contains a load segment that is not 16 KiB aligned." >&2
    exit 1
  fi
done

echo "Android SSH uses repository-built libssh2/OpenSSL for all four ABIs."
