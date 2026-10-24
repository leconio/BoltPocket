import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

test("runtime source contains no Node subprocess, WASM or host-eval dependency", () => {
  const runtimeFiles = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
  const forbidden = [
    /["']node:/u,
    /\bprocess\b/u,
    /\brequire\s*\(/u,
    /\bWebAssembly\b/u,
    /\bQuickJS\b/u,
    /\bchild_process\b/u,
    /\beval\s*\(/u,
    /\bnew\s+Function\b/u,
  ];

  for (const file of runtimeFiles) {
    const source = readFileSync(join(sourceDirectory, file), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${file} must stay React Native-safe`,
      );
    }
    if (file !== "runtime-polyfills.ts") {
      assert.doesNotMatch(
        source,
        /\bBuffer\b/u,
        `${file} must not rely on an implicit global Buffer`,
      );
    }
  }

  const polyfill = readFileSync(
    join(sourceDirectory, "runtime-polyfills.ts"),
    "utf8",
  );
  assert.match(polyfill, /from "buffer"/u);
});

test("basic, base64 and curl auth paths work without Hermes Buffer/btoa/atob globals", async () => {
  const names = ["Buffer", "btoa", "atob"] as const;
  const descriptors = new Map(
    names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  try {
    for (const name of names) {
      Reflect.deleteProperty(globalThis, name);
    }
    // Import only after the Hermes-missing globals are removed. The package's
    // explicit side-effect polyfill must run before just-bash is evaluated.
    const { MemoryProjectFileSystem, ProjectShell } =
      await import("./index.ts");
    let authorization = "";
    const shell = new ProjectShell({
      fileSystem: new MemoryProjectFileSystem({
        "/project/value.txt": "hello",
      }),
      root: "/project",
      fetch: async (_url, init) => {
        authorization = init.headers.authorization ?? "";
        return {
          status: 200,
          statusText: "OK",
          async text() {
            return "done";
          },
        };
      },
    });
    const result = await shell.execute({
      command:
        "cat value.txt; base64 value.txt; curl -sS -u mobile:secret https://example.test",
      cwd: "/project",
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "helloaGVsbG8=\ndone");
    assert.equal(authorization, "Basic bW9iaWxlOnNlY3JldA==");
  } finally {
    for (const name of names) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
