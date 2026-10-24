# Building locally

These instructions describe the tested Linux/WSL Android route. Check [device/model limitations](LIMITATIONS.md) and [model availability](MODEL.md) first. A compiled APK does not establish inference correctness on a different GPU or model.

## Toolchain

- Node 24.18+ within the 24.x series; pnpm 11.13+ within 11.x.
- Python 3, a host C/C++ compiler (`cc`, `g++`), Git, Bash, Make, Perl, Ninja, curl and archive utilities.
- JDK 17 and an Android SDK with platform/build tools, NDK 28 and CMake 3.22. The frozen S25 build used NDK 28.2.
- An ARM64 target with dotprod/i8mm. Native code currently selects `armv8.7-a+dotprod+i8mm`.

Use your own `JAVA_HOME` and `ANDROID_HOME`. Node dependencies and source downloads require network access. Build and release signing remain local; no hosted build is required.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` includes TypeScript checks, the focused Pi/mobile tests and six host C++ cache-integrity cases. It does not test the whole reused app, run a model, install an APK or require phone access.

## OpenCL inputs

Obtain [Khronos OpenCL-Headers](https://github.com/KhronosGroup/OpenCL-Headers) at `82f60316cc142e7b21dc1d8983b26de18858fbd9`. Set `OPENCL_INCLUDE_DIR` to the directory containing `CL/`.

For linking, supply an ARM64 `libOpenCL.so` from your own target device, for example from `/vendor/lib64/libOpenCL.so` where present. Paths and availability vary. Keep it outside this repository. **Do not redistribute the proprietary driver in the app.** The application loads the device's system vendor library at runtime through the optional `uses-native-library` declaration.

```sh
export OPENCL_INCLUDE_DIR=/absolute/path/to/OpenCL-Headers
export OPENCL_LIBRARY=/private/absolute/path/to/libOpenCL.so
export BOLT_OPENCL=1 BOLT_VULKAN=0
export BOLTPOCKET_ANDROID_ABIS=arm64-v8a BOLTPOCKET_BUILD_JOBS=6
export EXPO_PUBLIC_BOLTPOCKET_LOCAL_ONLY=1
export EXPO_NO_TELEMETRY=1

bash packages/expo-ssh/scripts/build-android-dependencies.sh
python3 tools/bolt/build_native.py android
node tools/bolt/prebuild.mjs android
cd app/android
./gradlew --no-daemon --max-workers=2 :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The native sources are already vendored and patched. Do not replace the llama.cpp directory with current upstream and assume the OpenCL fixes are preserved. See [OpenCL provenance](../tools/bolt/OPENCL.md). Vulkan is not an accepted S25 alternative.

The generated release build uses the local test-signing setup. Supply and protect your own release signing before any production distribution. No signing credentials are supplied. The generated Android/iOS folders and compiled libraries are ignored by Git; native module source remains tracked.

The optional `.devflow.json` records the same local Android steps for the author's project-dev runner. Its `boltpocket-opencl-android` preset is a logical preset name: configure that preset on your own host with tool paths, `JAVA_HOME`, `ANDROID_HOME`, `OPENCL_INCLUDE_DIR` and `OPENCL_LIBRARY`. Those machine paths and the private linking library are not part of the repository. Without project-dev, use the manual commands above.

Expo Go cannot run the custom inference/SSH/QuickJS modules. For development, first compile a native development build; the root `pnpm start` command starts Metro for an existing development client, not a native-module build.

## Import and fixtures

Import a separately obtained compatible GGUF as described in [MODEL.md](MODEL.md). No in-app model downloader or model conversion pipeline is supplied.

- `boltpocket://?bench=1`: one warmup plus three same-prompt English turns in fresh conversations; exact-prefix reuse is allowed.
- Add `&cache=off` to explicitly disable memory and disk prefix reuse.
- `boltpocket://?demo=1`: the three-turn English conversation through the same Pi send path.
- `boltpocket://projects`: project selection for real local-tool tasks.

Use a fresh process when changing native backend configuration. The default local workspace uses 16K context, not the older 8K fixture results. Model initialization and uncached tool-result prefill can still be slow.

Metrics are appended to the app external files directory as `bolt-metrics.ndjson`. Native metrics exclude conversation text and tool arguments. The fixture JS event is bridge arrival, not screen paint. Collect Android `dumpsys meminfo` externally if reporting observed peak total PSS/RSS; native VmRSS can omit GPU allocations.

## iOS source path

On a Mac with Xcode, CMake, CocoaPods and your own signing setup, build the SSH dependencies using `packages/expo-ssh/scripts/build-ios-dependencies.sh`, run `python3 tools/bolt/build_native.py ios`, then `node tools/bolt/prebuild.mjs ios`, install Pods and build the generated workspace normally in Xcode.

The native path selects Metal and iOS 18. The application configuration requests an increased-memory entitlement; source declarations do not guarantee that iOS grants the memory required by this model. iPhone installation, model import, actual inference performance and persistent-cache restoration are still pending physical validation. Do not describe the project as verified on both platforms.
