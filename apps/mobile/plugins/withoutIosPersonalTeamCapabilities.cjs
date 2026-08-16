const { withEntitlementsPlist } = require("expo/config-plugins");

function stripPersonalTeamEntitlements(entitlements) {
  delete entitlements["aps-environment"];
  delete entitlements["com.apple.developer.applesignin"];
  delete entitlements["com.apple.security.application-groups"];
  delete entitlements["com.apple.developer.associated-domains"];
  return entitlements;
}

function withoutIosPersonalTeamCapabilities(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    stripPersonalTeamEntitlements(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withoutIosPersonalTeamCapabilities;
module.exports.stripPersonalTeamEntitlements = stripPersonalTeamEntitlements;
