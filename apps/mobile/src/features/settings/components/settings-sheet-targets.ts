export type SettingsSheetTarget =
  | "SettingsEnvironments"
  // Devski fork: Paired Device management lives in Settings, not in a tab.
  | "SettingsDevices"
  | "SettingsArchive"
  | "SettingsAppearance"
  | "SettingsProjectGrouping"
  | "SettingsClientStorage"
  | "SettingsUsage";

export type SettingsLegalDocumentTarget = "SettingsLegal";
