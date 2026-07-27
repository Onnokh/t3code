/**
 * Resolve which directory to send to a remote OpenCode server as
 * `x-opencode-directory`.
 *
 * When `serverUrl` is set, the local project cwd usually does not exist on the
 * remote host. Prefer `workingDirectory/<project>`, else map under
 * `localDirectoryRoot` onto `remoteDirectoryRoot`, else keep the local cwd.
 *
 * For T3/PLOW worktree checkouts (`…/worktrees/<project>/<id>`), `<project>` is
 * used rather than the worktree leaf folder name.
 */
export function resolveOpenCodeRemoteDirectory(
  localCwd: string,
  openCodeSettings: {
    readonly serverUrl: string;
    readonly workingDirectory: string;
    readonly localDirectoryRoot: string;
    readonly remoteDirectoryRoot: string;
  },
): string {
  const serverUrl = openCodeSettings.serverUrl.trim();
  if (!serverUrl) {
    return localCwd;
  }

  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const local = normalize(localCwd);
  const project = projectNameForRemote(local);

  const workingDirectory = openCodeSettings.workingDirectory.trim();
  if (workingDirectory) {
    const remote = normalize(workingDirectory);
    return project ? `${remote}/${project}` : remote;
  }

  const remoteRoot = openCodeSettings.remoteDirectoryRoot.trim();
  if (!remoteRoot) {
    return localCwd;
  }

  const remote = normalize(remoteRoot);
  const localRoot = openCodeSettings.localDirectoryRoot.trim();
  if (localRoot) {
    const root = normalize(localRoot);
    if (local === root) {
      return remote;
    }
    if (local.startsWith(`${root}/`)) {
      return `${remote}/${local.slice(root.length + 1)}`;
    }
  }

  return project ? `${remote}/${project}` : remote;
}

function projectNameForRemote(normalizedLocalCwd: string): string {
  const parts = normalizedLocalCwd.split("/").filter(Boolean);
  const worktreesIdx = parts.lastIndexOf("worktrees");
  // …/worktrees/<project>/<worktree-id>
  if (worktreesIdx >= 0 && worktreesIdx + 2 < parts.length) {
    return parts[worktreesIdx + 1]!;
  }
  return parts.length > 0 ? parts[parts.length - 1]! : "";
}
