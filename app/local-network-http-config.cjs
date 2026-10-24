const {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
} = require("expo/config-plugins");

function applyIosLocalNetworkHttp(infoPlist) {
  const existing = infoPlist.NSAppTransportSecurity;
  infoPlist.NSAppTransportSecurity = {
    ...(existing && typeof existing === "object" ? existing : {}),
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: true,
  };
  return infoPlist;
}

function applyAndroidLocalNetworkHttp(application) {
  application.$ ??= {};
  application.$["android:usesCleartextTraffic"] = "true";
  return application;
}

function withLocalNetworkHttp(config) {
  const withIos = withInfoPlist(config, (next) => {
    next.modResults = applyIosLocalNetworkHttp(next.modResults);
    return next;
  });

  return withAndroidManifest(withIos, (next) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      next.modResults,
    );
    applyAndroidLocalNetworkHttp(application);
    return next;
  });
}

module.exports = withLocalNetworkHttp;
module.exports.applyAndroidLocalNetworkHttp = applyAndroidLocalNetworkHttp;
module.exports.applyIosLocalNetworkHttp = applyIosLocalNetworkHttp;
