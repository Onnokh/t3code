import { useEffect, type ComponentProps } from "react";
import { ActivityIndicator, View } from "react-native";
import { createStaticNavigation, getFocusedRouteNameFromRoute } from "@react-navigation/native";
import {
  createNativeBottomTabNavigator,
  createNativeBottomTabScreen,
} from "@react-navigation/bottom-tabs/unstable";
import {
  createNativeStackNavigator,
  createNativeStackScreen,
} from "@react-navigation/native-stack";

import { GLASS_HEADER_OPTIONS, RootStack } from "../../Stack";
import { getDevskiBrandHeaderOptions } from "./DevskiBrandTitle";
import { useEnvironments } from "../../state/environments";
import { ConnectionsNewRouteScreen } from "../connection/ConnectionsNewRouteScreen";
import { useConnectionController } from "../connection/useConnectionController";
import { codeTabBarDisplay } from "./devski-shell-chrome";
import {
  useDevskiActivityReconciliation,
  useDevskiPushToStartRegistration,
} from "./notifications/automationNotifications";
import { AutomationJobDetailScreen } from "./automations/AutomationJobDetailScreen";
import { AutomationJobEditorScreen } from "./automations/AutomationJobEditorScreen";
import { AutomationRunDetailScreen } from "./automations/AutomationRunDetailScreen";
import { AutomationsJobsScreen } from "./automations/AutomationsJobsScreen";
import { SeoHistoryScreen } from "./seo/SeoHistoryScreen";
import { SeoHomeScreen } from "./seo/SeoHomeScreen";
import { SeoLogScreen } from "./seo/SeoLogScreen";
import { SeoOpportunitiesScreen } from "./seo/SeoOpportunitiesScreen";
import { SeoPageDetailScreen } from "./seo/SeoPageDetailScreen";
import { SeoQueriesScreen } from "./seo/SeoQueriesScreen";
import { SeoRegistryScreen } from "./seo/SeoRegistryScreen";

const SeoStack = createNativeStackNavigator({
  screenOptions: GLASS_HEADER_OPTIONS,
  screens: {
    SeoHome: createNativeStackScreen({
      screen: SeoHomeScreen,
      options: getDevskiBrandHeaderOptions("SEO"),
    }),
    SeoOpportunities: createNativeStackScreen({
      screen: SeoOpportunitiesScreen,
      options: { title: "Opportunities" },
    }),
    SeoHistory: createNativeStackScreen({
      screen: SeoHistoryScreen,
      options: { title: "History" },
    }),
    SeoRegistry: createNativeStackScreen({
      screen: SeoRegistryScreen,
      options: { title: "Registry" },
    }),
    SeoLog: createNativeStackScreen({
      screen: SeoLogScreen,
      options: { title: "Log" },
    }),
    SeoQueries: createNativeStackScreen({
      screen: SeoQueriesScreen,
      options: { title: "Queries" },
    }),
    SeoPage: createNativeStackScreen({
      screen: SeoPageDetailScreen,
      options: { title: "Page" },
    }),
  },
});

const AutomationsStack = createNativeStackNavigator({
  screenOptions: GLASS_HEADER_OPTIONS,
  screens: {
    AutomationsHome: createNativeStackScreen({
      screen: AutomationsJobsScreen,
      options: getDevskiBrandHeaderOptions("Automations"),
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
      // The Automation Notification deep link (PLO-420). The path carries
      // one opaque Run ID; opening it requires a current Device Session
      // because an unauthorized shell renders pairing instead of tabs.
      linking: "automations/runs/:runId",
    }),
  },
});

const DevskiTabs = createNativeBottomTabNavigator({
  initialRouteName: "Code",
  screenOptions: { headerShown: false },
  screens: {
    Code: createNativeBottomTabScreen({
      screen: RootStack,
      // T3 owns the bottom edge on the routes it pushes full-screen, so the
      // tab bar steps aside there instead of sitting under their composers.
      options: ({ route }) => ({
        title: "Code",
        tabBarIcon: { type: "sfSymbol", name: "chevron.left.forwardslash.chevron.right" },
        tabBarStyle: { display: codeTabBarDisplay(getFocusedRouteNameFromRoute(route)) },
      }),
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
  // A Run finishes whether or not Automations is on screen, so the shell
  // owns ending the Devski Activity: at launch it clears a card that
  // outlived the process that armed it, and on foreground one whose Run
  // ended while Devski was closed.
  useDevskiActivityReconciliation();
  // The Gateway can only create a card if it holds this device's
  // push-to-start token, and that is the whole point: a scheduled Run
  // fires while Devski is closed.
  useDevskiPushToStartRegistration();
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
