import { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { AppText as Text } from "../../../components/AppText";
import { EmptyState } from "../../../components/EmptyState";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { useConnectionController } from "../../connection/useConnectionController";
import { PlainButton, SectionTitle } from "../automations/AutomationsUi";
import { useDevicesClient } from "./devices-api";
import { describeDeviceLines, sortDevices, type PairedDevice } from "./devices-state";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly devices: readonly PairedDevice[] };

const PAIRING_REQUIRED_MESSAGE =
  "This Device Session expired or was revoked. Pair this device again.";

/**
 * Plain Paired Device management (PLO-421): the list comes from T3's
 * persisted session metadata through the Gateway relay. Revoking another
 * device and signing out this device are separate, individually confirmed
 * destructive actions; neither cancels Code work or an Automation Run.
 */
export function DevicesScreen() {
  const devices = useDevicesClient();
  const { removeEnvironment } = useConnectionController();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!devices) return;
    const result = await devices.client.listDevices();
    if (result.kind === "ok") setState({ kind: "ready", devices: sortDevices(result.value) });
    else if (result.kind === "pairing-required") {
      setState({ kind: "error", message: PAIRING_REQUIRED_MESSAGE });
    } else setState({ kind: "error", message: result.error.message });
  }, [devices]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const revokeDevice = useCallback(
    (device: PairedDevice) => {
      if (!devices) return;
      Alert.alert(
        `Revoke ${device.name}?`,
        "That device loses Code, Gateway, push, and Live Activity access immediately and must pair again. Running Code work and Automation Runs are not cancelled.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Revoke",
            style: "destructive",
            onPress: () => {
              setBusy(true);
              void devices.client
                .revokeDevice(device.sessionId)
                .then((result) => {
                  if (result.kind === "error") {
                    setState({ kind: "error", message: result.error.message });
                  } else if (result.kind === "pairing-required") {
                    setState({ kind: "error", message: PAIRING_REQUIRED_MESSAGE });
                  } else {
                    void load();
                  }
                })
                .finally(() => setBusy(false));
            },
          },
        ],
      );
    },
    [devices, load],
  );

  const signOutThisDevice = useCallback(() => {
    if (!devices) return;
    Alert.alert(
      "Sign out this device?",
      "This revokes this device's session on the server, clears the local pairing, and returns to pairing. Running Code work and Automation Runs are not cancelled.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void devices.client
              .signOut()
              .then((result) => {
                if (result.kind === "error") {
                  // The server stays authoritative: without its confirmation
                  // the local credential is kept and the failure is shown.
                  setState({ kind: "error", message: result.error.message });
                  return;
                }
                // "ok" is the confirmed revocation; "pairing-required" means
                // the session was already gone — both are authoritative, so
                // clear local pairing state and return to pairing.
                void removeEnvironment(devices.environmentId);
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }, [devices, removeEnvironment]);

  if (!devices) {
    return (
      <View className="flex-1 bg-screen">
        <EmptyState
          variant="plain"
          title="Pair this device"
          detail="Pair this device in Code to manage Paired Devices."
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 20 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {state.kind === "loading" ? (
        <Text className="text-sm text-foreground-muted">Loading Paired Devices…</Text>
      ) : null}
      {state.kind === "error" ? <ErrorBanner message={state.message} /> : null}
      {state.kind === "ready" ? (
        <>
          <SectionTitle>Paired Devices</SectionTitle>
          {state.devices.length === 0 ? (
            <Text className="text-sm text-foreground-muted">No Paired Devices.</Text>
          ) : (
            state.devices.map((device) => (
              <View
                key={device.sessionId}
                className="rounded-2xl border border-border bg-card px-4 py-3"
              >
                <Text className="font-t3-bold text-foreground">
                  {device.current ? `${device.name} (this device)` : device.name}
                </Text>
                {describeDeviceLines(device).map((line, index) => (
                  <Text key={index} className="mt-0.5 text-sm text-foreground-muted">
                    {line}
                  </Text>
                ))}
                {device.current ? null : (
                  <View className="mt-3">
                    <PlainButton
                      label="Revoke"
                      destructive
                      disabled={busy}
                      onPress={() => revokeDevice(device)}
                    />
                  </View>
                )}
              </View>
            ))
          )}
          <SectionTitle>This device</SectionTitle>
          <PlainButton
            label="Sign out this device"
            destructive
            disabled={busy}
            onPress={signOutThisDevice}
          />
        </>
      ) : null}
    </ScrollView>
  );
}
