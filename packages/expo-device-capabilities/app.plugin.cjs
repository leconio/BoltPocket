const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withBoltPocketDeviceCapabilities(config) {
  return withInfoPlist(config, (next) => {
    next.modResults.NSBluetoothAlwaysUsageDescription ??=
      "Allow BoltPocket to discover and communicate with nearby Bluetooth devices only when an authorized Agent task needs it.";
    next.modResults.NSLocalNetworkUsageDescription ??=
      "Allow BoltPocket to communicate with local-network devices declared by an authorized project Device Profile.";
    next.modResults.NSLocationWhenInUseUsageDescription ??=
      "Allow BoltPocket to read your location while an authorized Agent task is using it.";
    return next;
  });
};
