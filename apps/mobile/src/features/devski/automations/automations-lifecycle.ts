import type { AutomationJob } from "./automations-state";

/**
 * Pure lifecycle rules for the plain Job detail screen (PLO-419). The
 * server stays authoritative for every mutation; these helpers only
 * decide which standard controls the screen offers and what the
 * destructive confirmation says.
 */

export type LifecycleAction = "enable" | "disable" | "archive" | "restore" | "duplicate" | "delete";

/**
 * Which lifecycle controls one Job offers. An archived Job restores,
 * duplicates, or deletes; an active Job toggles automatic Triggers
 * (manual-only Jobs have none), archives, duplicates, or deletes.
 */
export function availableLifecycleActions(job: AutomationJob): readonly LifecycleAction[] {
  if (job.archivedAt) return ["restore", "duplicate", "delete"];
  const toggle: LifecycleAction[] =
    job.trigger.kind === "manual" ? [] : [job.enabled ? "disable" : "enable"];
  return [...toggle, "archive", "duplicate", "delete"];
}

/** Permanent deletion is unavailable while a Run is pending or running. */
export function deleteBlockedByActiveRun(job: AutomationJob): boolean {
  return Boolean(job.activeRunId);
}

/** Suggested starting name for a duplicate; the copy needs its own name. */
export function suggestDuplicateName(name: string): string {
  return `${name} copy`;
}

/**
 * The destructive confirmation summarizes everything permanent deletion
 * removes (remote-action safety policy) before asking for the typed name.
 */
export function describeDeletionScope(job: AutomationJob, runCount: number): string {
  const runs = `${runCount} recorded Run${runCount === 1 ? "" : "s"}`;
  return (
    `This permanently removes the Job "${job.name}", its Workspace, ${runs}, ` +
    "their logs, and their Artifacts. This cannot be undone. " +
    "Type the exact Job name to confirm."
  );
}
