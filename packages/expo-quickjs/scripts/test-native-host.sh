#!/bin/sh
set -eu

package_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/boltpocket-quickjs-test.XXXXXX")
trap 'rm -rf -- "$build_dir"' EXIT HUP INT TERM

cc=${CC:-cc}
cxx=${CXX:-c++}
quickjs_dir="$package_dir/cpp/quickjs"

for source in quickjs cutils dtoa libregexp libunicode; do
  "$cc" -std=gnu11 -O1 -DCONFIG_VERSION='"boltpocket-vendored-1.0.1"' \
    -I"$quickjs_dir" -c "$quickjs_dir/$source.c" \
    -o "$build_dir/$source.o"
done

"$cxx" -std=c++17 -O1 -I"$package_dir/cpp" -I"$quickjs_dir" \
  "$package_dir/cpp/BoltPocketQuickJsExecutor.cpp" \
  "$package_dir/cpp/tests/BoltPocketQuickJsExecutorTest.cpp" \
  "$build_dir/quickjs.o" "$build_dir/cutils.o" "$build_dir/dtoa.o" \
  "$build_dir/libregexp.o" "$build_dir/libunicode.o" -lm -pthread \
  -o "$build_dir/boltpocket-quickjs-test"

"$build_dir/boltpocket-quickjs-test"

cmake_file="$package_dir/android/CMakeLists.txt"
for linker_flag in \
  '-Wl,-z,max-page-size=16384' \
  '-Wl,-z,common-page-size=16384'
do
  if ! grep -F -- "$linker_flag" "$cmake_file" >/dev/null; then
    echo "Missing Android 16 KiB linker flag: $linker_flag" >&2
    exit 1
  fi
done

echo "Android QuickJS linker configuration supports 16 KiB pages."
