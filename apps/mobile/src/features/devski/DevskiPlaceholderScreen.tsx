import { ScrollView } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";

export function DevskiPlaceholderScreen(props: {
  readonly area: "SEO" | "Automations";
  readonly detail: string;
}) {
  const { connectedEnvironments, connectionError, connectionState } = useRemoteConnectionStatus();
  const connectionSummary =
    connectionError ??
    `${connectedEnvironments.length} Code environment${connectedEnvironments.length === 1 ? "" : "s"} available (${connectionState}).`;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ gap: 12, paddingHorizontal: 20, paddingVertical: 20 }}
    >
      <Text className="text-sm leading-normal text-foreground-muted">{props.detail}</Text>
      <Text className="mt-2 font-t3-bold text-foreground">Digital Home connection</Text>
      <Text className="text-sm leading-normal text-foreground-muted" selectable>
        {connectionSummary}
      </Text>
      <Text className="font-t3-bold text-foreground">Gateway service health</Text>
      <Text className="text-sm leading-normal text-foreground-muted" selectable>
        The Devski Gateway is unavailable in this local shell checkpoint.
      </Text>
      <EmptyState
        variant="plain"
        title={`${props.area} is coming next`}
        detail="This functional shell uses the same paired environment as Code."
      />
    </ScrollView>
  );
}
