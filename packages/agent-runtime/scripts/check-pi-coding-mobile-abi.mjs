import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SUPPORTED_VERSION = "0.83.0";
const UPSTREAM_PACKAGE = "@earendil-works/pi-coding-agent";
const CORE_TOOLS_SUBPATH = `${UPSTREAM_PACKAGE}/core/tools`;
const EXPECTED_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
];

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const runtimePackageJson = JSON.parse(
  await readFile(resolve(packageDirectory, "package.json"), "utf8"),
);
const workspaceYaml = await readFile(
  resolve(repositoryRoot, "pnpm-workspace.yaml"),
  "utf8",
);
const patchPath = `patches/@earendil-works__pi-coding-agent@${SUPPORTED_VERSION}.patch`;
const patchText = await readFile(resolve(repositoryRoot, patchPath), "utf8");

assert.equal(
  runtimePackageJson.dependencies?.[UPSTREAM_PACKAGE],
  SUPPORTED_VERSION,
  `${UPSTREAM_PACKAGE} must remain exactly pinned until its mobile ABI patch is intentionally rebased.`,
);
for (const packageName of [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
]) {
  assert.equal(
    runtimePackageJson.dependencies?.[packageName],
    SUPPORTED_VERSION,
    `${packageName} must stay aligned with ${UPSTREAM_PACKAGE}.`,
  );
}
assert.match(
  workspaceYaml,
  new RegExp(
    `"@earendil-works/pi-coding-agent@${SUPPORTED_VERSION.replaceAll(".", "\\.")}":\\s+${patchPath.replaceAll("/", "\\/")}`,
    "u",
  ),
  `pnpm patchedDependencies must bind ${UPSTREAM_PACKAGE}@${SUPPORTED_VERSION} to ${patchPath}.`,
);

const resolvedCoreTools = fileURLToPath(
  import.meta.resolve(CORE_TOOLS_SUBPATH),
);
const installedPackageDirectory = resolve(
  dirname(resolvedCoreTools),
  "../../..",
);
const installedPackageJson = JSON.parse(
  await readFile(resolve(installedPackageDirectory, "package.json"), "utf8"),
);
assert.equal(
  installedPackageJson.version,
  SUPPORTED_VERSION,
  `Installed ${UPSTREAM_PACKAGE} does not match the supported mobile ABI version. Run pnpm install after resolving the version intentionally.`,
);
assert.deepEqual(installedPackageJson.exports?.["./core/tools"], {
  types: "./dist/core/tools/index.d.ts",
  import: "./dist/core/tools/index.js",
});

const installedFiles = {
  bashDeclaration: await readFile(
    resolve(installedPackageDirectory, "dist/core/tools/bash.d.ts"),
    "utf8",
  ),
  bashImplementation: await readFile(
    resolve(installedPackageDirectory, "dist/core/tools/bash.js"),
    "utf8",
  ),
  grepDeclaration: await readFile(
    resolve(installedPackageDirectory, "dist/core/tools/grep.d.ts"),
    "utf8",
  ),
  grepImplementation: await readFile(
    resolve(installedPackageDirectory, "dist/core/tools/grep.js"),
    "utf8",
  ),
  outputDeclaration: await readFile(
    resolve(
      installedPackageDirectory,
      "dist/core/tools/output-accumulator.d.ts",
    ),
    "utf8",
  ),
  outputImplementation: await readFile(
    resolve(installedPackageDirectory, "dist/core/tools/output-accumulator.js"),
    "utf8",
  ),
};

const requiredInstalledMarkers = [
  [installedFiles.bashDeclaration, "environment?: NodeJS.ProcessEnv;"],
  [installedFiles.bashDeclaration, "persistTruncatedOutput?: boolean;"],
  [installedFiles.bashImplementation, "environment ?? getShellEnv()"],
  [installedFiles.bashImplementation, "persistOutput: persistTruncatedOutput"],
  [installedFiles.grepDeclaration, "search?: (input:"],
  [installedFiles.grepImplementation, "if (ops.search)"],
  [installedFiles.outputDeclaration, "persistOutput?: boolean;"],
  [installedFiles.outputImplementation, "if (!this.persistOutput)"],
];
for (const [source, marker] of requiredInstalledMarkers) {
  assert.ok(
    source.includes(marker),
    `Installed ${UPSTREAM_PACKAGE} is missing the mobile ABI marker: ${marker}`,
  );
}

for (const marker of [
  '"./core/tools"',
  "environment?: NodeJS.ProcessEnv;",
  "persistTruncatedOutput?: boolean;",
  "search?: (input:",
  "persistOutput?: boolean;",
]) {
  assert.ok(
    patchText.includes(marker),
    `The checked-in pnpm patch is missing the mobile ABI marker: ${marker}`,
  );
}

const coreTools = await import(CORE_TOOLS_SUBPATH);
assert.equal(typeof coreTools.createAllToolDefinitions, "function");
assert.deepEqual([...coreTools.allToolNames], EXPECTED_TOOL_NAMES);

process.stdout.write(
  `Pi Coding Agent mobile ABI OK (${SUPPORTED_VERSION}; ${EXPECTED_TOOL_NAMES.join(", ")}).\n`,
);
