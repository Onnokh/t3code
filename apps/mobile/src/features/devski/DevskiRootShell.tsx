import { useState, type ComponentProps } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createStaticNavigation } from "@react-navigation/native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { RootStack } from "../../Stack";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { useDevskiGateway, type DevskiGatewayState } from "./gateway";

const Navigation = createStaticNavigation(RootStack);
type NavigationProps = ComponentProps<typeof Navigation>;

type DevskiTab = "code" | "seo" | "automations";

const TAB_LABELS: ReadonlyArray<{ readonly key: DevskiTab; readonly label: string }> = [
  { key: "code", label: "Code" },
  { key: "seo", label: "SEO" },
  { key: "automations", label: "Automations" },
];

export function DevskiRootShell(props: Pick<NavigationProps, "linking" | "theme">) {
  const [selectedTab, setSelectedTab] = useState<DevskiTab>("code");
  const insets = useSafeAreaInsets();
  const gateway = useDevskiGateway();

  return (
    <View className="flex-1 bg-screen">
      <View className="flex-1">
        <View className="flex-1" style={{ display: selectedTab === "code" ? "flex" : "none" }}>
          <Navigation {...props} />
        </View>
        <View
          className="flex-1"
          style={{ display: selectedTab === "seo" ? "flex" : "none" }}
          accessibilityElementsHidden={selectedTab !== "seo"}
        >
          <DevskiPlaceholderScreen
            area="SEO"
            detail="Read-only Ranksta data will appear here."
            gateway={gateway}
          />
        </View>
        <View
          className="flex-1"
          style={{ display: selectedTab === "automations" ? "flex" : "none" }}
          accessibilityElementsHidden={selectedTab !== "automations"}
        >
          <DevskiPlaceholderScreen
            area="Automations"
            detail="Harness Jobs and Runs will appear here."
            gateway={gateway}
          />
        </View>
      </View>

      <View
        className="flex-row border-t border-border bg-sheet"
        style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      >
        {TAB_LABELS.map((tab) => {
          const isSelected = selectedTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              className="flex-1 items-center px-2 py-3 active:opacity-70"
              onPress={() => setSelectedTab(tab.key)}
            >
              <Text className={isSelected ? "font-t3-bold text-primary" : "text-foreground-muted"}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DevskiPlaceholderScreen(props: {
  readonly area: "SEO" | "Automations";
  readonly detail: string;
  readonly gateway: DevskiGatewayState;
}) {
  const { connectedEnvironments, connectionError, connectionState } = useRemoteConnectionStatus();
  const connectionSummary =
    connectionError ??
    (connectedEnvironments.length === 0
      ? "No Code environment is paired on this device."
      : `${connectedEnvironments.length} Code environment${connectedEnvironments.length === 1 ? "" : "s"} available (${connectionState}).`);
  const serviceKey = props.area === "SEO" ? "seo" : "automations";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ gap: 12, paddingHorizontal: 20, paddingVertical: 20 }}
    >
      <Text className="text-xl font-t3-bold text-foreground">{props.area}</Text>
      <Text className="text-sm leading-normal text-foreground-muted">{props.detail}</Text>
      <Text className="mt-2 font-t3-bold text-foreground">Digital Home connection</Text>
      <Text className="text-sm leading-normal text-foreground-muted">{connectionSummary}</Text>
      <Text className="font-t3-bold text-foreground">Gateway service health</Text>
      <Text className="text-sm leading-normal text-foreground-muted">{props.gateway.message}</Text>
      {props.gateway.status === "ready" ? (
        <Text className="text-sm leading-normal text-foreground-muted">
          {props.area}: {props.gateway.capabilities.capabilities[serviceKey].status}.
        </Text>
      ) : null}
      <EmptyState
        variant="plain"
        title={`${props.area} is coming next`}
        detail="This functional shell uses the same paired Device Session as Code."
      />
    </ScrollView>
  );
}
