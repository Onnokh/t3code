import { useEffect, type ComponentProps } from "react";
import { ActivityIndicator, View } from "react-native";
import { createStaticNavigation } from "@react-navigation/native";
import {
  createNativeBottomTabNavigator,
  createNativeBottomTabScreen,
} from "@react-navigation/bottom-tabs/unstable";
import {
  createNativeStackNavigator,
  createNativeStackScreen,
} from "@react-navigation/native-stack";

import { RootStack } from "../../Stack";
import { useEnvironments } from "../../state/environments";
import { ConnectionsNewRouteScreen } from "../connection/ConnectionsNewRouteScreen";
import { useConnectionController } from "../connection/useConnectionController";
import { AutomationJobDetailScreen } from "./automations/AutomationJobDetailScreen";
import { AutomationJobEditorScreen } from "./automations/AutomationJobEditorScreen";
import { AutomationRunDetailScreen } from "./automations/AutomationRunDetailScreen";
import { AutomationsJobsScreen } from "./automations/AutomationsJobsScreen";
import { SeoPlaceholderScreen } from "./SeoPlaceholderScreen";

const SeoStack = createNativeStackNavigator({
  screens: {
    SeoHome: createNativeStackScreen({
      screen: SeoPlaceholderScreen,
      options: { title: "SEO" },
    }),
  },
});

const AutomationsStack = createNativeStackNavigator({
  screens: {
    AutomationsHome: createNativeStackScreen({
      screen: AutomationsJobsScreen,
      options: { title: "Automations" },
    }),
    AutomationJob: createNativeStackScreen({
      screen: AutomationJobDetailScreen,
      options: { title: "Job" },
    }),
    AutomationJobEditor: createNativeStackScreen({
      screen: AutomationJobEditorScreen,
      options: { title: "Job Editor" },
    }),
    AutomationRun: createNativeStackScreen({
      screen: AutomationRunDetailScreen,
      options: { title: "Run" },
    }),
  },
});

const DevskiTabs = createNativeBottomTabNavigator({
  initialRouteName: "Code",
  screenOptions: { headerShown: false },
  screens: {
    Code: createNativeBottomTabScreen({
      screen: RootStack,
      options: {
        title: "Code",
        tabBarIcon: { type: "sfSymbol", name: "chevron.left.forwardslash.chevron.right" },
      },
    }),
    SEO: createNativeBottomTabScreen({
      screen: SeoStack,
      options: {
        title: "SEO",
        tabBarIcon: { type: "sfSymbol", name: "chart.line.uptrend.xyaxis" },
      },
    }),
    Automations: createNativeBottomTabScreen({
      screen: AutomationsStack,
      options: {
        title: "Automations",
        tabBarIcon: {
          type: "sfSymbol",
          name: "clock.arrow.trianglehead.counterclockwise.rotate.90",
        },
      },
    }),
  },
});

const Navigation = createStaticNavigation(DevskiTabs);
type NavigationProps = ComponentProps<typeof Navigation>;

const PairingStack = createNativeStackNavigator({
  initialRouteName: "Pair",
  screens: {
    Pair: createNativeStackScreen({
      screen: ConnectionsNewRouteScreen,
      initialParams: { mode: "scan_qr" },
      options: { title: "Pair Devski", headerBackVisible: false },
    }),
  },
});
const PairingNavigation = createStaticNavigation(PairingStack);

export function DevskiRootShell(props: Pick<NavigationProps, "linking" | "theme">) {
  const { environments, isReady } = useEnvironments();
  const { removeEnvironment } = useConnectionController();
  const authorizedEnvironments = environments.filter(
    (environment) => environment.connection.failureReason !== "authentication",
  );

  useEffect(() => {
    for (const environment of environments) {
      if (environment.connection.failureReason === "authentication") {
        void removeEnvironment(environment.environmentId);
      }
    }
  }, [environments, removeEnvironment]);

  if (!isReady) {
    return (
      <View className="flex-1 items-center justify-center bg-screen">
        <ActivityIndicator />
      </View>
    );
  }
  if (authorizedEnvironments.length === 0) {
    return <PairingNavigation theme={props.theme} />;
  }
  return <Navigation {...props} />;
}
