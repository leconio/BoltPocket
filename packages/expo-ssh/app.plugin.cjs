const path = require("node:path");

const { withInfoPlist, withPodfile } = require("expo/config-plugins");

const dependencyMarker = "  # BoltPocket SSH native dependencies";

function relativeIosPath(modRequest, filename = "") {
  const podspec = path.join(__dirname, "ios", filename);
  return path
    .relative(modRequest.platformProjectRoot, podspec)
    .split(path.sep)
    .join("/");
}

function rubyString(value) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function nativeDependencyBlock(modRequest) {
  return [
    dependencyMarker,
    `  pod 'BoltPocketOpenSSLCrypto', :podspec => ${rubyString(relativeIosPath(modRequest, "BoltPocketOpenSSLCrypto.podspec"))}`,
    `  pod 'BoltPocketLibssh2', :path => ${rubyString(relativeIosPath(modRequest))}`,
    `  pod 'NMSSH', :podspec => ${rubyString(relativeIosPath(modRequest, "NMSSH.podspec"))}`,
  ].join("\n");
}

module.exports = function withBoltPocketSsh(config) {
  const withIosNetworkUsage = withInfoPlist(config, (next) => {
    next.modResults.NSLocalNetworkUsageDescription ??=
      "BoltPocket uses the local network only when you run an SSH command for a project.";
    return next;
  });

  return withPodfile(withIosNetworkUsage, (next) => {
    if (next.modResults.contents.includes(dependencyMarker)) return next;
    const target = /target\s+["'][^"']+["']\s+do\s*\n/u;
    if (!target.test(next.modResults.contents)) {
      throw new Error("Could not find the iOS application target for NMSSH.");
    }
    const legacyNmsshPod = /^\s*pod\s+["']NMSSH["'].*\n?/mu;
    next.modResults.contents = next.modResults.contents.replace(
      legacyNmsshPod,
      "",
    );
    next.modResults.contents = next.modResults.contents.replace(
      target,
      (match) => `${match}${nativeDependencyBlock(next.modRequest)}\n`,
    );
    return next;
  });
};
