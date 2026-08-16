import Constants from "expo-constants";
import type {
  NativeStackHeaderItem,
  NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { Platform, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { brandTitleOffset } from "../../components/CompactBrandTitle";
import { resolveMobileStageLabel } from "../../lib/mobileBranding";
import { useThemeColor } from "../../lib/useThemeColor";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";

/**
 * The Devski lockup: the product name and the build stage, sized and offset
 * exactly like T3's own brand title so every Area's header starts at the
 * same point. Devski has no wordmark artwork of its own yet, so this is set
 * in the app's own typeface rather than dressed up as a logo.
 */
export function DevskiBrandTitle(
  props: {
    readonly nativeLeadingItem?: boolean;
  } = {},
) {
  const foregroundColor = useThemeColor("--color-icon");
  const mutedColor = useThemeColor("--color-foreground-muted");
  const subtleColor = useThemeColor("--color-subtle");
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);

  return (
    <View
      aria-level={1}
      accessibilityLabel="Devski"
      accessible
      role="heading"
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
        marginLeft: brandTitleOffset(props.nativeLeadingItem === true),
      }}
    >
      <Text
        style={{
          color: foregroundColor,
          fontFamily: "DMSans-Bold",
          fontSize: 21,
          letterSpacing: -0.5,
        }}
      >
        Devski
      </Text>
      <View
        style={{
          backgroundColor: subtleColor,
          borderRadius: 999,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}
      >
        <Text
          style={{
            color: mutedColor,
            fontFamily: "DMSans-Bold",
            fontSize: 9,
            letterSpacing: 0.9,
            textTransform: "uppercase",
          }}
        >
          {stageLabel}
        </Text>
      </View>
    </View>
  );
}

function renderDevskiBrandHeaderItems(): NativeStackHeaderItem[] {
  return [
    {
      element: <DevskiBrandTitle nativeLeadingItem />,
      hidesSharedBackground: true,
      type: "custom",
    },
  ];
}

function renderDevskiBrandTitle() {
  return <DevskiBrandTitle />;
}

/**
 * Header options for an Area root. `title` is what the route is called in
 * back buttons and accessibility, never what the bar shows: the bar shows
 * the lockup, so all three Areas open on the same mark.
 */
export function getDevskiBrandHeaderOptions(title: string): NativeStackNavigationOptions {
  if (Platform.OS === "ios" && NATIVE_LIQUID_GLASS_SUPPORTED) {
    return {
      headerTitle: title,
      headerTitleStyle: { color: "transparent", fontSize: 18, fontWeight: "800" },
      title,
      unstable_headerLeftItems: renderDevskiBrandHeaderItems,
    };
  }

  return {
    headerTitle: renderDevskiBrandTitle,
    title,
  };
}
