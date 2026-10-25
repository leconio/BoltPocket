import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const patch = readFileSync(
  new URL(
    "../../../../patches/react-native-webview@13.16.1.patch",
    import.meta.url,
  ),
  "utf8",
);
const snapshots = readFileSync(
  new URL("./expo-project-preview-snapshots.ts", import.meta.url),
  "utf8",
);

test("Android intercepts the same isolated preview origin and cache written by the app", () => {
  const pattern = patch.match(/\+\s+"(\^preview-[^"\n]+)"\.toRegex\(\)/u)?.[1];
  assert.ok(pattern);
  const hostPattern = new RegExp(pattern.replaceAll("\\\\", "\\"));
  const suffix = snapshots.match(/https:\/\/preview-\$\{id\}\.([^/`]+)/u)?.[1];
  assert.ok(suffix);
  assert.equal(hostPattern.test(`preview-${"a".repeat(32)}.${suffix}`), true);
  assert.equal(
    hostPattern.test(`preview-${"a".repeat(32)}.untrusted.invalid`),
    false,
  );
  assert.equal(hostPattern.test(`preview-${"a".repeat(31)}.${suffix}`), false);
  const cache = snapshots.match(
    /new Directory\(Paths\.cache, "([^"]+)", "([^"]+)"\)/u,
  );
  assert.ok(cache);
  assert.ok(patch.includes(`"${cache[1]}/${cache[2]}"`));
  assert.ok(patch.includes('"boltpocket/h5-runtimes/v1/files"'));
});

test("native capability controls register the same property names as the browser host", () => {
  const host = readFileSync(
    new URL("../../features/browser/app-browser-host.tsx", import.meta.url),
    "utf8",
  );
  const expected = [
    ...new Set(host.match(/boltpocketAllows[A-Za-z]+/gu)),
  ].sort();
  const registered = [
    ...new Set(
      [...patch.matchAll(/@ReactProp\(name = "([^"]*Allows[^"]+)"/gu)].map(
        (m) => m[1],
      ),
    ),
  ].sort();
  assert.equal(expected.length, 5);
  assert.deepEqual(registered, expected);
  for (const key of expected)
    assert.ok(patch.includes(`${key}?: WithDefault<boolean,`));
});

test("the frozen dependency lock binds the exact native WebView patch", () => {
  const hash = createHash("sha256").update(patch).digest("hex");
  const lock = readFileSync(
    new URL("../../../../pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  assert.ok(lock.includes(`react-native-webview@13.16.1: ${hash}`));
});
