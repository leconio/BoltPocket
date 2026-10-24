const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const serviceName = "com.asterinet.react.bgactions.RNBackgroundActionsTask";

module.exports = function withAgentBackgroundExecution(config) {
  const withPermissions = AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  ]);

  return withAndroidManifest(withPermissions, (next) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      next.modResults,
    );
    application.service ??= [];
    let service = application.service.find((candidate) => {
      const name = candidate.$?.["android:name"];
      return name === serviceName || name?.endsWith(".RNBackgroundActionsTask");
    });
    if (!service) {
      service = { $: { "android:name": serviceName } };
      application.service.push(service);
    }
    service.$ ??= {};
    service.$["android:name"] = serviceName;
    service.$["android:exported"] = "false";
    service.$["android:foregroundServiceType"] = "dataSync";
    service.$["android:stopWithTask"] = "false";
    return next;
  });
};
