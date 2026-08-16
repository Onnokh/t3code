const { IOSConfig, withXcodeProject } = require("expo/config-plugins");

/**
 * Stamp one Apple team onto every signable iOS target.
 *
 * Expo's own `withDevelopmentTeam` runs before the config plugins that create
 * the extension targets, and `expo-sharing` never writes DEVELOPMENT_TEAM for
 * the share extension it adds. One target without a team makes
 * `expo run:ios` treat the whole project as unsigned: it resolves an identity
 * from the keychain and rewrites DEVELOPMENT_TEAM on *every* signable target,
 * so a machine with more than one Apple team silently replaces the configured
 * team and the wildcard provisioning profile no longer carries the App Group,
 * push, Sign in with Apple, or associated-domains capabilities.
 */
function unquote(value) {
  return String(value).replace(/^"(.*)"$/, "$1");
}

function stampDevelopmentTeam(project, appleTeamId) {
  const targets = IOSConfig.Target.findSignableTargets(project);
  const projectSections = Object.entries(IOSConfig.XcodeUtils.getProjectSection(project)).filter(
    IOSConfig.XcodeUtils.isNotComment,
  );
  const stampedTargets = [];

  for (const [targetId, target] of targets) {
    for (const [, buildConfiguration] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
      project,
      target.buildConfigurationList,
    )) {
      buildConfiguration.buildSettings.DEVELOPMENT_TEAM = appleTeamId;
    }

    // Xcode reads the signing pane from TargetAttributes, xcodebuild reads the
    // build settings. Keep both in step so opening the project does not offer
    // to "fix" the team back to the keychain default.
    for (const [, projectSection] of projectSections) {
      if (!projectSection.attributes) {
        projectSection.attributes = {};
      }
      if (!projectSection.attributes.TargetAttributes) {
        projectSection.attributes.TargetAttributes = {};
      }
      if (!projectSection.attributes.TargetAttributes[targetId]) {
        projectSection.attributes.TargetAttributes[targetId] = {};
      }
      projectSection.attributes.TargetAttributes[targetId].DevelopmentTeam = appleTeamId;
    }

    stampedTargets.push(unquote(target.name));
  }

  return stampedTargets;
}

module.exports = function withIosDevelopmentTeam(config) {
  const appleTeamId = config.ios?.appleTeamId;
  if (typeof appleTeamId !== "string" || appleTeamId.trim() === "") {
    throw new Error(
      "withIosDevelopmentTeam requires ios.appleTeamId; without it expo run:ios signs with whichever Apple team the keychain offers first.",
    );
  }

  return withXcodeProject(config, (nextConfig) => {
    stampDevelopmentTeam(nextConfig.modResults, appleTeamId.trim());
    return nextConfig;
  });
};

module.exports.stampDevelopmentTeam = stampDevelopmentTeam;
