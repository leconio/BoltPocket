const path = require("node:path");
const fs = require("node:fs");

const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
const runtimeDependencyRoot = path.join(
  projectRoot,
  "../packages/agent-runtime/node_modules/@earendil-works",
);
const piAgentEntry = path.join(
  projectRoot,
  "src/infrastructure/agent/rn-pi-agent-core-shim.ts",
);
const piAiPackageRoot = fs.realpathSync(
  path.join(runtimeDependencyRoot, "pi-ai"),
);
const piCodingAgentPackageRoot = fs.realpathSync(
  path.join(runtimeDependencyRoot, "pi-coding-agent"),
);
const piAiShim = path.join(
  projectRoot,
  "src/infrastructure/agent/rn-pi-ai-shim.ts",
);
const piAiModelsShim = path.join(
  projectRoot,
  "src/infrastructure/agent/rn-pi-ai-models-shim.ts",
);
const piAiProviderEnvShim = path.join(
  projectRoot,
  "src/infrastructure/agent/rn-pi-ai-provider-env-shim.ts",
);
const justBashPackageRoot = fs.realpathSync(
  path.join(projectRoot, "../packages/project-shell/node_modules/just-bash"),
);
const projectShellZlibShim = path.join(
  projectRoot,
  "../packages/project-shell/src/node-zlib-shim.ts",
);
const piCodingNodeShim = path.join(
  projectRoot,
  "src/infrastructure/agent/rn-pi-coding-node-shim.ts",
);
const piCodingHeadlessShim = path.join(
  projectRoot,
  "src/infrastructure/agent/rn-pi-coding-headless-shim.ts",
);
const pathBrowserifyEntry = require.resolve("path-browserify");

const piCodingNodeModules = new Set([
  "fs",
  "fs/promises",
  "node:fs",
  "node:fs/promises",
  "child_process",
  "node:child_process",
  "node:crypto",
  "node:os",
  "node:readline",
  "node:url",
]);

function isPiCodingHeadlessModule(moduleName) {
  return [
    "/config.js",
    "/modes/interactive/components/diff.js",
    "/modes/interactive/components/keybinding-hints.js",
    "/modes/interactive/components/visual-truncate.js",
    "/modes/interactive/theme/theme.js",
    "/child-process.js",
    "/utils/image-process.js",
    "/utils/mime.js",
    "/utils/shell.js",
    "/utils/tools-manager.js",
    "/render-utils.js",
  ].some((suffix) => moduleName.endsWith(suffix));
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@earendil-works/pi-agent-core") {
    return { type: "sourceFile", filePath: piAgentEntry };
  }
  if (moduleName === "@earendil-works/pi-ai") {
    return { type: "sourceFile", filePath: piAiShim };
  }
  if (
    context.originModulePath.startsWith(piAiPackageRoot) &&
    moduleName === "../models.js"
  ) {
    return { type: "sourceFile", filePath: piAiModelsShim };
  }
  if (
    context.originModulePath.startsWith(piAiPackageRoot) &&
    moduleName === "../utils/provider-env.js"
  ) {
    return { type: "sourceFile", filePath: piAiProviderEnvShim };
  }
  if (context.originModulePath.startsWith(piCodingAgentPackageRoot)) {
    if (moduleName === "path" || moduleName === "node:path") {
      return { type: "sourceFile", filePath: pathBrowserifyEntry };
    }
    if (piCodingNodeModules.has(moduleName)) {
      return { type: "sourceFile", filePath: piCodingNodeShim };
    }
    if (
      moduleName === "@earendil-works/pi-tui" ||
      isPiCodingHeadlessModule(moduleName)
    ) {
      return { type: "sourceFile", filePath: piCodingHeadlessShim };
    }
  }
  if (
    context.originModulePath.startsWith(justBashPackageRoot) &&
    moduleName === "node:zlib"
  ) {
    return { type: "sourceFile", filePath: projectShellZlibShim };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
