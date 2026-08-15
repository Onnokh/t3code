import { ScrollView } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { useDevskiGateway } from "./gateway";
import { describeServiceHealth } from "./gateway-state";

export function DevskiPlaceholderScreen(props: {
  readonly area: "SEO" | "Automations";
  readonly detail: string;
}) {
  const { connectedEnvironments, connectionError, connectionState } = useRemoteConnectionStatus();
  const gateway = useDevskiGateway();
  const connectionSummary =
    connectionError ??
    `${connectedEnvironments.length} Code environment${connectedEnvironments.length === 1 ? "" : "s"} available (${connectionState}).`;
  const areaHealth =
    gateway.kind === "ready"
      ? props.area === "SEO"
        ? gateway.capabilities.capabilities.seo
        : gateway.capabilities.capabilities.automations
      : null;
  const sessionExpiry = gateway.kind === "ready" ? gateway.capabilities.session.expiresAt : null;

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
        {gateway.message}
      </Text>
      {areaHealth ? (
        <Text className="text-sm leading-normal text-foreground-muted" selectable>
          {props.area}: {describeServiceHealth(areaHealth)}
        </Text>
      ) : null}
      {sessionExpiry ? (
        <Text className="text-sm leading-normal text-foreground-muted" selectable>
          Device Session valid until {new Date(sessionExpiry).toLocaleString()}.
        </Text>
      ) : null}
      <EmptyState
        variant="plain"
        title={`${props.area} is coming next`}
        detail="This vertical slice reuses the paired Device Session across Code, SEO, and Automations."
      />
    </ScrollView>
  );
}
