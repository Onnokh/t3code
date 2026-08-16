export type DevskiAppVariant = "development" | "preview" | "production";

/**
 * The only source of truth for identities owned by the Devski fork.
 *
 * Keep this deliberately small: values here are copied into resolved Expo
 * configuration and are also consumed by the release guard.
 */
export const DEVSKI_IDENTITY = {
  productName: "Devski",
  slug: "devski",
  expoOwner: "onnokleinhofmeijer",
  gatewayUrl: "https://devski.onkie.dev",
  legalOrigin: "https://devski.onkie.dev",
  supportUrl: "https://devski.onkie.dev/support",
  scheme: "devski",
  marketingVersion: "0.1.0",
  iosBundleIdentifier: "dev.onkie.devski",
  iosAppGroupIdentifier: "group.dev.onkie.devski",
  iosShareExtensionSuffix: "sharing",
  iosWidgetExtensionSuffix: "widgets",
  appleTeamId: "5Q5AZ5596L",
  // These remain empty until their external records exist. Keeping the empty
  // values here stops Expo and EAS from silently inheriting upstream identity.
  easProjectId: null as string | null,
  appStoreConnectAppId: null as string | null,
  updateUrl: null as string | null,
  associatedDomains: [] as ReadonlyArray<string>,
} as const;

export const DEVSKI_GATEWAY_URL: string = DEVSKI_IDENTITY.gatewayUrl;

const VARIANT_SUFFIXES: Record<DevskiAppVariant, string> = {
  development: ".dev",
  preview: ".preview",
  production: "",
};

export function resolveDevskiIdentity(variant: DevskiAppVariant) {
  const suffix = VARIANT_SUFFIXES[variant];
  const iosBundleIdentifier = `${DEVSKI_IDENTITY.iosBundleIdentifier}${suffix}`;

  return {
    appName:
      variant === "development"
        ? `${DEVSKI_IDENTITY.productName} Dev`
        : variant === "preview"
          ? `${DEVSKI_IDENTITY.productName} Preview`
          : DEVSKI_IDENTITY.productName,
    scheme: suffix === "" ? DEVSKI_IDENTITY.scheme : `${DEVSKI_IDENTITY.scheme}${suffix}`,
    iosBundleIdentifier,
    androidPackage: iosBundleIdentifier,
    iosAppGroupIdentifier: `group.${iosBundleIdentifier}`,
    iosShareExtensionBundleIdentifier: `${iosBundleIdentifier}.${DEVSKI_IDENTITY.iosShareExtensionSuffix}`,
    iosWidgetExtensionBundleIdentifier: `${iosBundleIdentifier}.${DEVSKI_IDENTITY.iosWidgetExtensionSuffix}`,
  } as const;
}
