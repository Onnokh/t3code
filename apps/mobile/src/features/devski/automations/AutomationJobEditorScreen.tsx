import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import {
  StackActions,
  useNavigation,
  type NavigationProp,
  type StaticScreenProps,
} from "@react-navigation/native";

import { AppText as Text, AppTextInput as TextInput } from "../../../components/AppText";
import { ErrorBanner } from "../../../components/ErrorBanner";
import { uuidv4 } from "../../../lib/uuid";
import { useAutomationsClient } from "./automations-api";
import {
  TIMEZONE_CHOICES,
  WEEKDAY_NAMES,
  commandReviewLines,
  cronFromDraft,
  draftFromJob,
  draftToDefinition,
  emptyDraft,
  needsCommandReview,
  toggleSecretRef,
  type JobDefinitionInput,
  type JobDraft,
  type RecurrencePreset,
} from "./automations-authoring";
import {
  summarizeError,
  type AutomationJob,
  type AutomationsStackParamList,
  type ModelCatalog,
} from "./automations-state";
import { NativeHeaderToolbar } from "../../../native/StackHeader";
import { ChoiceRow, SectionTitle } from "./AutomationsUi";

type Params = { readonly jobId: string } | undefined;

type BaseState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly job: AutomationJob | null };

type ModelsState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "ready"; readonly catalog: ModelCatalog };

type SecretsState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "ready"; readonly names: readonly string[] };

const RECURRENCE_PRESETS: ReadonlyArray<{
  readonly preset: RecurrencePreset;
  readonly label: string;
}> = [
  { preset: "hourly", label: "Every hour" },
  { preset: "daily", label: "Every day" },
  { preset: "weekly", label: "Every week" },
  { preset: "custom", label: "Advanced (cron)" },
];

function Label(props: { readonly children: string }) {
  return <Text className="mt-3 text-sm text-foreground-muted">{props.children}</Text>;
}

function FieldProblem(props: { readonly message?: string }) {
  if (!props.message) return null;
  return <Text className="mt-1 text-xs text-rose-500">{props.message}</Text>;
}

function Input(props: {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly monospace?: boolean;
  readonly keyboardType?: "default" | "numeric";
}) {
  return (
    <TextInput
      className={`rounded-2xl border border-border bg-card px-4 text-base leading-snug text-foreground ${
        props.multiline ? "min-h-24 py-3" : "h-12 min-h-12 py-0"
      } ${props.monospace ? "font-mono text-sm" : ""}`}
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      multiline={props.multiline}
      keyboardType={props.keyboardType ?? "default"}
    />
  );
}

/**
 * Plain create/edit form for Agent and Command Jobs (PLO-418). Standard T3
 * controls only. The server stays authoritative: model choices come from
 * the live OpenCode catalog, Secret References are names only, Command
 * authoring passes the safety policy's review sheet, and a stale edit
 * surfaces a revision conflict with an authoritative reload.
 */
export function AutomationJobEditorScreen({ route }: StaticScreenProps<Params>) {
  const jobId = route.params?.jobId;
  const navigation = useNavigation<NavigationProp<AutomationsStackParamList>>();
  const client = useAutomationsClient();

  const [base, setBase] = useState<BaseState>(
    jobId ? { kind: "loading" } : { kind: "ready", job: null },
  );
  const [draft, setDraft] = useState<JobDraft>(emptyDraft());
  const [models, setModels] = useState<ModelsState>({ kind: "loading" });
  const [secrets, setSecrets] = useState<SecretsState>({ kind: "loading" });
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const createKey = useRef<string | null>(null);

  const patch = useCallback((change: Partial<JobDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
  }, []);

  // Model choices are refreshed from the server when the editor opens.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.listModels().then((result) => {
      if (cancelled) return;
      if (result.kind === "ok") setModels({ kind: "ready", catalog: result.value });
      else setModels({ kind: "unavailable", message: summarizeError(result) });
    });
    void client.listSecretReferences().then((result) => {
      if (cancelled) return;
      if (result.kind === "ok") setSecrets({ kind: "ready", names: result.value });
      else setSecrets({ kind: "unavailable", message: summarizeError(result) });
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!client || !jobId) return;
    let cancelled = false;
    void client.getJob(jobId).then((result) => {
      if (cancelled) return;
      if (result.kind === "ok") {
        setBase({ kind: "ready", job: result.value });
        setDraft(draftFromJob(result.value));
      } else {
        setBase({ kind: "error", message: summarizeError(result) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, jobId]);

  const adoptServerJob = useCallback((job: AutomationJob) => {
    // Authoritative reload: replace the draft with the server's current
    // Job Revision so the user can reapply their intent. Never overwrite.
    setBase({ kind: "ready", job });
    setDraft(draftFromJob(job));
    setProblems({});
    setBanner(
      `Loaded the current server version (revision ${job.revision}). Reapply your changes.`,
    );
  }, []);

  const presentRevisionConflict = useCallback(
    (serverJob: AutomationJob | undefined) => {
      Alert.alert(
        "Job changed on the server",
        serverJob
          ? `This edit was based on an outdated Job Revision. The server now has revision ${serverJob.revision}. Load the server version and reapply your changes; saving over it is not possible.`
          : "This edit was based on an outdated Job Revision. Reload the Job and reapply your changes.",
        serverJob
          ? [
              { text: "Keep editing", style: "cancel" },
              { text: "Load server version", onPress: () => adoptServerJob(serverJob) },
            ]
          : [{ text: "OK" }],
      );
    },
    [adoptServerJob],
  );

  const submit = useCallback(
    async (
      definition: JobDefinitionInput,
      baseJob: AutomationJob | null,
      confirmCommand?: string,
    ) => {
      if (!client) return;
      setSaving(true);
      setBanner(null);
      const result = baseJob
        ? await client.updateJob(baseJob.id, baseJob.revision, definition, confirmCommand)
        : await ((createKey.current ??= uuidv4()),
          client.createJob(definition, createKey.current, confirmCommand));
      setSaving(false);
      if (result.kind === "ok") {
        createKey.current = null;
        if (baseJob) {
          navigation.goBack();
        } else {
          navigation.dispatch(
            StackActions.replace("AutomationJob", {
              jobId: result.value.id,
              name: result.value.name,
            }),
          );
        }
        return;
      }
      if (result.kind === "pairing-required") {
        setBanner("This Device Session expired or was revoked. Pair this device again.");
        return;
      }
      createKey.current = null;
      if (result.error.code === "revision_conflict") {
        presentRevisionConflict(result.error.job);
        return;
      }
      if (result.error.code === "validation_failed" && result.error.fieldErrors) {
        const serverProblems: Record<string, string> = {};
        for (const [field, messages] of Object.entries(result.error.fieldErrors)) {
          const first = messages[0];
          if (first) serverProblems[field] = first;
        }
        setProblems(serverProblems);
      }
      setBanner(result.error.message);
    },
    [client, navigation, presentRevisionConflict],
  );

  const onSave = useCallback(async () => {
    if (!client || base.kind !== "ready") return;
    const check = draftToDefinition(draft, new Date());
    if (check.kind === "invalid") {
      setProblems(check.errors);
      setBanner("Some fields need attention before saving.");
      return;
    }
    setProblems({});

    // The review sheet refetches current state immediately before
    // submission (remote-action safety policy).
    let currentJob = base.job;
    if (currentJob) {
      const refetched = await client.getJob(currentJob.id);
      if (refetched.kind !== "ok") {
        setBanner(summarizeError(refetched));
        return;
      }
      if (refetched.value.revision !== currentJob.revision) {
        presentRevisionConflict(refetched.value);
        return;
      }
      currentJob = refetched.value;
    }

    if (needsCommandReview(check.definition, currentJob)) {
      // Authority-bearing review confirmation for Command Job authoring:
      // one concise sheet with the exact command, repository, schedule,
      // timeout, and Secret Reference names. No biometric; never a value.
      // Accepting sends `confirmCommand` — the exact reviewed command text —
      // which the server verifies before storing the Job.
      const confirmedCommand =
        check.definition.work.kind === "command" ? check.definition.work.command : undefined;
      Alert.alert(
        currentJob ? "Save this shell command?" : "Create this Command Job?",
        commandReviewLines(check.definition).join("\n"),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: currentJob ? "Save Command Job" : "Create Command Job",
            onPress: () => void submit(check.definition, currentJob, confirmedCommand),
          },
        ],
      );
      return;
    }
    void submit(check.definition, currentJob);
  }, [base, client, draft, presentRevisionConflict, submit]);

  if (!client) {
    return (
      <View className="flex-1 bg-screen px-5 py-5">
        <ErrorBanner message="Pair this device in Code to use Automations." />
      </View>
    );
  }
  if (base.kind === "loading") {
    return (
      <View className="flex-1 bg-screen px-5 py-5">
        <Text className="text-sm text-foreground-muted">Loading Job…</Text>
      </View>
    );
  }
  if (base.kind === "error") {
    return (
      <View className="flex-1 bg-screen px-5 py-5">
        <ErrorBanner message={base.message} />
      </View>
    );
  }

  const editing = base.job !== null;
  const derivedCron =
    draft.recurrencePreset === "custom" ? draft.cron : (cronFromDraft(draft) ?? "");
  const knownModelIds =
    models.kind === "ready"
      ? new Set(models.catalog.models.map((choice) => choice.id))
      : new Set<string>();

  return (
    <>
      {/* The form's one confirming action. In the navigation bar it is
          reachable from any field, instead of only from the bottom of a
          form this long. */}
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Button
          accessibilityLabel={editing ? "Save Job" : "Create Job"}
          label={editing ? "Save" : "Create"}
          disabled={saving}
          onPress={() => void onSave()}
          separateBackground
        />
      </NativeHeaderToolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1 bg-screen"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {saving ? <Text className="text-sm text-foreground-muted">Saving Job…</Text> : null}
        {banner ? <ErrorBanner message={banner} /> : null}
        <Text className="font-t3-bold text-xl text-foreground">
          {editing ? `Edit ${base.job?.name ?? "Job"}` : "New Job"}
        </Text>
        {editing ? (
          <Text className="text-xs text-foreground-muted">
            Editing revision {base.job?.revision}. A newer server revision blocks this save.
          </Text>
        ) : null}

        {!editing ? (
          <>
            <SectionTitle>Job type</SectionTitle>
            <ChoiceRow
              label="Agent Job"
              detail="An OpenCode prompt"
              selected={draft.kind === "agent"}
              onPress={() => patch({ kind: "agent" })}
            />
            <ChoiceRow
              label="Command Job"
              detail="A shell command that invokes a Tool"
              selected={draft.kind === "command"}
              onPress={() => patch({ kind: "command" })}
            />
          </>
        ) : null}

        <SectionTitle>Name</SectionTitle>
        <Input
          value={draft.name}
          onChangeText={(name) => patch({ name })}
          placeholder="daily-report"
        />
        <FieldProblem message={problems.name} />

        <SectionTitle>{draft.kind === "agent" ? "Prompt" : "Command"}</SectionTitle>
        {draft.kind === "agent" ? (
          <>
            <Input
              value={draft.prompt}
              onChangeText={(prompt) => patch({ prompt })}
              placeholder="What should the agent do each Run?"
              multiline
            />
            <FieldProblem message={problems.prompt ?? problems.work} />
          </>
        ) : (
          <>
            <Input
              value={draft.command}
              onChangeText={(command) => patch({ command })}
              placeholder="sleevy-seo-daily"
              multiline
              monospace
            />
            <FieldProblem message={problems.command ?? problems.work} />
            <Text className="text-xs text-foreground-muted">
              The command runs exactly as written in a restricted worker with only the selected
              Secret References. Saving a new or changed command asks for review first.
            </Text>
          </>
        )}

        {draft.kind === "agent" ? (
          <>
            <SectionTitle>Model</SectionTitle>
            {models.kind === "loading" ? (
              <Text className="text-sm text-foreground-muted">Loading live model choices…</Text>
            ) : null}
            {models.kind === "unavailable" ? (
              <Text className="text-sm text-foreground-muted">
                The live model catalog is unavailable ({models.message}). The server default is used
                unless the Job already names a model.
              </Text>
            ) : null}
            <ChoiceRow
              label="Server default"
              detail={
                models.kind === "ready" && models.catalog.defaultModel
                  ? `Currently ${models.catalog.defaultModel}`
                  : "OpenCode picks its default at Run start"
              }
              selected={draft.model === ""}
              onPress={() => patch({ model: "" })}
            />
            {models.kind === "ready"
              ? models.catalog.models.map((choice) => (
                  <ChoiceRow
                    key={choice.id}
                    label={choice.name}
                    detail={choice.id}
                    selected={draft.model === choice.id}
                    onPress={() => patch({ model: choice.id })}
                  />
                ))
              : null}
            {draft.model !== "" && !knownModelIds.has(draft.model) ? (
              <ChoiceRow
                label={draft.model}
                detail="Not in the current catalog; this Job cannot Trigger until it is available again"
                selected
                onPress={() => patch({ model: "" })}
              />
            ) : null}
            <FieldProblem message={problems.model} />
          </>
        ) : null}

        <SectionTitle>Trigger</SectionTitle>
        <ChoiceRow
          label="Manual only"
          detail="Runs only when you tap Run Now"
          selected={draft.triggerKind === "manual"}
          onPress={() => patch({ triggerKind: "manual" })}
        />
        <ChoiceRow
          label="One-shot"
          detail="Runs once at a future instant"
          selected={draft.triggerKind === "oneShot"}
          onPress={() => patch({ triggerKind: "oneShot" })}
        />
        <ChoiceRow
          label="Recurring"
          detail="Runs on a schedule; new schedules start disabled"
          selected={draft.triggerKind === "recurring"}
          onPress={() => patch({ triggerKind: "recurring" })}
        />
        <FieldProblem message={problems.trigger} />

        {draft.triggerKind === "oneShot" ? (
          <>
            <Label>Run at (ISO-8601 instant)</Label>
            <Input
              value={draft.runAt}
              onChangeText={(runAt) => patch({ runAt })}
              placeholder="2026-09-01T09:00:00+02:00"
              monospace
            />
            <FieldProblem message={problems.runAt} />
          </>
        ) : null}

        {draft.triggerKind === "recurring" ? (
          <>
            <Label>Repeats</Label>
            {RECURRENCE_PRESETS.map((option) => (
              <ChoiceRow
                key={option.preset}
                label={option.label}
                selected={draft.recurrencePreset === option.preset}
                onPress={() => patch({ recurrencePreset: option.preset })}
              />
            ))}
            {draft.recurrencePreset === "weekly" ? (
              <>
                <Label>On</Label>
                {WEEKDAY_NAMES.map((day, index) => (
                  <ChoiceRow
                    key={day}
                    label={day}
                    selected={draft.recurrenceWeekday === index}
                    onPress={() => patch({ recurrenceWeekday: index })}
                  />
                ))}
              </>
            ) : null}
            {draft.recurrencePreset === "hourly" ? (
              <>
                <Label>At minute (via HH:MM, the minute part is used)</Label>
                <Input
                  value={draft.recurrenceTime}
                  onChangeText={(recurrenceTime) => patch({ recurrenceTime })}
                  placeholder="00:15"
                  monospace
                />
              </>
            ) : null}
            {draft.recurrencePreset === "daily" || draft.recurrencePreset === "weekly" ? (
              <>
                <Label>At time (HH:MM)</Label>
                <Input
                  value={draft.recurrenceTime}
                  onChangeText={(recurrenceTime) => patch({ recurrenceTime })}
                  placeholder="09:00"
                  monospace
                />
              </>
            ) : null}
            <Label>Advanced cron</Label>
            <Input
              value={derivedCron}
              onChangeText={(cron) => patch({ cron, recurrencePreset: "custom" })}
              placeholder="0 9 * * *"
              monospace
            />
            <FieldProblem message={problems.cron} />
          </>
        ) : null}

        {draft.triggerKind !== "manual" ? (
          <>
            <Label>Timezone (IANA)</Label>
            {TIMEZONE_CHOICES.map((zone) => (
              <ChoiceRow
                key={zone}
                label={zone}
                selected={draft.timezone === zone}
                onPress={() => patch({ timezone: zone })}
              />
            ))}
            <Input
              value={draft.timezone}
              onChangeText={(timezone) => patch({ timezone })}
              placeholder="Europe/Amsterdam"
            />
            <FieldProblem message={problems.timezone} />
          </>
        ) : null}

        <SectionTitle>Timeout (minutes)</SectionTitle>
        <Input
          value={draft.timeoutMinutes}
          onChangeText={(timeoutMinutes) => patch({ timeoutMinutes })}
          placeholder="30"
          keyboardType="numeric"
        />
        <FieldProblem message={problems.timeoutMinutes} />

        <SectionTitle>Repository (optional)</SectionTitle>
        <Input
          value={draft.repositoryUrl}
          onChangeText={(repositoryUrl) => patch({ repositoryUrl })}
          placeholder="https://github.com/org/repo.git"
        />
        <FieldProblem message={problems.repositoryUrl ?? problems.repository} />

        <SectionTitle>Secret References</SectionTitle>
        {secrets.kind === "loading" ? (
          <Text className="text-sm text-foreground-muted">Loading Secret Reference names…</Text>
        ) : null}
        {secrets.kind === "unavailable" ? (
          <Text className="text-sm text-foreground-muted">
            Secret Reference names are unavailable ({secrets.message}).
          </Text>
        ) : null}
        {secrets.kind === "ready" && secrets.names.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            No Secret References are configured.
          </Text>
        ) : null}
        {secrets.kind === "ready"
          ? secrets.names.map((name) => (
              <ChoiceRow
                key={name}
                label={name}
                detail="Selected by name; the value stays on the server"
                selected={draft.secretRefs.includes(name)}
                onPress={() => patch({ secretRefs: toggleSecretRef(draft.secretRefs, name) })}
              />
            ))
          : null}
        {draft.secretRefs
          .filter((name) => secrets.kind === "ready" && !secrets.names.includes(name))
          .map((name) => (
            <ChoiceRow
              key={name}
              label={name}
              detail="No longer available; deselect or reconfigure it on the server"
              selected
              onPress={() => patch({ secretRefs: toggleSecretRef(draft.secretRefs, name) })}
            />
          ))}
        <FieldProblem message={problems.secretRefs} />
      </ScrollView>
    </>
  );
}
