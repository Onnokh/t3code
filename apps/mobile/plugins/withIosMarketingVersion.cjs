const { IOSConfig, withXcodeProject } = require("expo/config-plugins");

/**
 * Stamp the app's marketing version onto every signable iOS target.
 *
 * Apple requires an app extension's CFBundleShortVersionString to equal its
 * containing app's. The plugins that create the share and widget extensions
 * leave MARKETING_VERSION at the Xcode template default of 1.0, and
 * `expo-sharing-extension`'s Info.plist resolves the key through
 * `$(MARKETING_VERSION)` — so a project whose app is 0.1.0 ships an extension
 * claiming 1.0. Locally that is only a warning; App Store Connect rejects the
 * upload, which turns it into a TestFlight blocker discovered at the worst
 * moment.
 *
 * Expo writes the version to the app target from `version`, but not to targets
 * that do not exist yet when it runs. Same shape of problem as
 * withIosDevelopmentTeam, and the same fix: run last and stamp them all.
 */
function unquote(value) {
  return String(value).replace(/^"(.*)"$/, "$1");
}

function stampMarketingVersion(project, marketingVersion) {
  const targets = IOSConfig.Target.findSignableTargets(project);
  const stampedTargets = [];

  for (const [, target] of targets) {
    for (const [, buildConfiguration] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      target.buildConfigurationList,
    )) {
      buildConfiguration.buildSettings.MARKETING_VERSION = marketingVersion;
    }

    stampedTargets.push(unquote(target.name));
  }

  return stampedTargets;
}

module.exports = function withIosMarketingVersion(config) {
  const marketingVersion = config.version;
  if (typeof marketingVersion !== "string" || marketingVersion.trim() === "") {
    throw new Error(
      "withIosMarketingVersion requires a version; without it the extensions keep Xcode's 1.0 default and App Store Connect rejects the build.",
    );
  }

  return withXcodeProject(config, (nextConfig) => {
    stampMarketingVersion(nextConfig.modResults, marketingVersion.trim());
    return nextConfig;
  });
};

module.exports.stampMarketingVersion = stampMarketingVersion;
