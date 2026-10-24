import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(resolve(packageRoot, "vendor-manifest.json"), "utf8"),
);

for (const [relativePath, expected] of Object.entries(manifest.files)) {
  const contents = await readFile(resolve(packageRoot, relativePath));
  const actual = createHash("sha256").update(contents).digest("hex");
  if (actual !== expected) {
    throw new Error(`Vendored QuickJS hash mismatch: ${relativePath}`);
  }
}

console.log(
  `Verified ${Object.keys(manifest.files).length} QuickJS source files.`,
);
