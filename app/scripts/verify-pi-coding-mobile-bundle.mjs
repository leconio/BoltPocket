import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = mkdtempSync(join(tmpdir(), "boltpocket-pi-tools-"));

try {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "expo",
      "export",
      "--platform",
      "android",
      "--output-dir",
      outputDirectory,
    ],
    {
      cwd: appRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Android Pi Coding Agent bundle failed (${result.status}).`,
    );
  }
  if (!existsSync(join(outputDirectory, "metadata.json"))) {
    throw new Error(
      "Android Pi Coding Agent bundle did not emit metadata.json.",
    );
  }
  process.stdout.write("Pi Coding Agent Android bundle regression passed.\n");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
