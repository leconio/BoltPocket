# `@boltpocket/expo-quickjs`

Bounded JavaScript execution for the BoltPocket Expo development build. Each call
creates a fresh native QuickJS runtime and context that is independent from the
React Native Hermes runtime. Android uses a dedicated single-thread coroutine
dispatcher; iOS uses a dedicated serial `DispatchQueue`, so an interrupted
`while (true) {}` does not occupy the React Native JavaScript or UI thread.

```ts
import { BoltPocketQuickJs } from "@boltpocket/expo-quickjs";

const abortController = new AbortController();
if (BoltPocketQuickJs.isAvailable) {
  const execution = await BoltPocketQuickJs.execute({
    code: "console.log(input.name); ({ doubled: input.value * 2 })",
    filename: "calculation.js",
    input: { name: "BoltPocket", value: 21 },
    signal: abortController.signal,
  });
}
```

The package also exports `availability`, `isAvailable`, and `execute` directly;
`BoltPocketQuickJs` groups the same API for call sites that prefer a namespace.

`execute` resolves to `{ stdout, stderr, result, exitCode }`. A string result is
returned unchanged; other representable values are returned as JSON text;
`undefined` becomes `null`. `console.log/info/debug` write to stdout and
`console.warn/error` write to stderr.

QuickJS supports `BigInt`, and a final `BigInt` value is returned as exact
decimal text. Agent-facing instructions require `BigInt` rather than `Number`
whenever integer operands or results may exceed `Number.MAX_SAFE_INTEGER`.

## Fixed limits

The TypeScript boundary and native boundary both validate requests:

- code: at most 512 KiB of UTF-8;
- JSON input: at most 256 KiB;
- timeout: 10 ms–10 seconds (default 1 second);
- QuickJS heap: 1–64 MiB (default 16 MiB);
- QuickJS stack: 256 KiB–1 MiB (default 512 KiB);
- captured stdout + stderr + result: 1 KiB–1 MiB (default 64 KiB);

The native executor accounts for the three output fields together. Before a
QuickJS string, JSON value, or exception is copied into a host `std::string`,
its exact UTF-8 length is compared with the remaining output budget. The
TypeScript bridge independently recomputes the combined UTF-8 size against the
specific `maxOutputBytes` requested by that call and rejects an inconsistent
native response.

The native executor calls `JS_SetMemoryLimit`, `JS_SetMaxStackSize`,
`JS_SetCanBlock(false)`, and a monotonic-deadline `JS_SetInterruptHandler`.
An optional `AbortSignal` sets a native atomic cancellation flag that the same
interrupt handler observes. Cancellations received while another execution is
on the serial queue are remembered in a bounded native set and applied when
that execution starts; the hard timeout remains the final bound.
On iOS, Expo dispatches `execute` directly onto that dedicated queue rather
than occupying Expo's shared async-function queue while QuickJS runs.
Every exit path frees the context and runtime. Immediate Promise jobs are
drained; a Promise that requires unavailable I/O fails instead of remaining
alive.

## Isolation boundary

Only ECMAScript, a JSON-decoded global `input`, and bounded `console` methods
are present. This package does not compile `quickjs-libc`, `std`, or `os`, and
does not install `require`, module loaders, `fetch`, timers, React Native native
modules, JSI callbacks, files, sockets, or processes. Static and dynamic module
loading therefore fail closed. Runs share no globals or QuickJS context state.

This is a deliberately small computation tool, not arbitrary local shell
access. The app still owns tool policy and must not treat a successful script
as approval for a project mutation.

The mobile Agent exposes this executor as the read-only `js_exec` tool and as
the `js-exec` ProjectShell command. Both pass only explicit JSON input. Project
files are never mounted into QuickJS or copied as an implicit whole-project
snapshot.

## Reproducible native source

QuickJS is vendored under `cpp/quickjs`; CocoaPods and Gradle never download
engine source. The exact npm artifact and SHA-256 file hashes are recorded in
`vendor-manifest.json`. Run `pnpm verify:vendor` to verify the snapshot. See
`THIRD_PARTY_NOTICES.md` for MIT attribution. No Apache-licensed implementation
is copied into this package; the separately used Just Bash project retains its
own Apache-2.0 notice in `@boltpocket/project-shell`.

The Android shared library is linked with 16 KiB-compatible ELF page alignment
while remaining compatible with 4 KiB devices. This is configured in the
package-owned CMake target so Expo prebuild regeneration cannot discard it.
