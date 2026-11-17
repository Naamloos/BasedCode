import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Workspace } from "../../shared/types.js";
import type { Events } from "../storage/events.js";
import type { Store } from "../storage/store.js";
import {
  gitDirty,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreeRemove,
} from "../workspace/workspace.js";
import type { Workspaces } from "./workspaces.js";

export interface WorktreeDeps {
  store: Store;
  events: Events;
  workspaces: Pick<Workspaces, "open" | "remove">;
  /** Folder for BasedCode's own helper files; holds the empty hooks folder. */
  managedDirectory: string;
  assertIdle: (workspaceId: string) => void;
}

export interface WorktreeInfo {
  workspaceId?: string;
  name?: string;
  path: string;
  branch?: string;
  head?: string;
  /** Created and tracked by BasedCode, so it can be removed from here. */
  managed: boolean;
  main: boolean;
}

/**
 * Git worktrees as BasedCode workspaces. Each worktree opens as its own workspace that remembers the workspace and
 * branch it came from, so chats in it run in parallel with the original checkout.
 */
export class Worktrees {
  constructor(private readonly deps: WorktreeDeps) {}

  /** The workspace a worktree came from, or the workspace itself when it is not a worktree. */
  origin(workspace: Workspace): Workspace {
    const parent = workspace.worktreeOf?.workspaceId;
    if (!parent) return workspace;
    return this.deps.store.all("workspace").find((item) => item.id === parent) ?? workspace;
  }

  async create(
    from: Workspace,
    branch: string,
    options: { base?: string; existing?: boolean } = {},
  ): Promise<Workspace> {
    const { store, events, workspaces, managedDirectory } = this.deps;
    if (from.scratch) throw new Error("Plain chats have no Git repository.");
    const origin = this.origin(from);
    const hooks = join(managedDirectory, "empty-git-hooks");
    await mkdir(hooks, { recursive: true });
    const { path } = await gitWorktreeAdd(origin, branch, {
      ...options,
      emptyHooksDirectory: hooks,
    });
    const opened = await workspaces.open(path);
    const workspace = store.put("workspace", {
      ...opened,
      name: `${origin.name} · ${branch}`,
      settings: structuredClone(origin.settings),
      worktreeOf: { workspaceId: origin.id, branch },
    });
    events.publish("state");
    return workspace;
  }

  async list(workspace: Workspace): Promise<WorktreeInfo[]> {
    const workspaces = this.deps.store.all("workspace").filter((item) => !item.removedAt);
    const items = await gitWorktreeList(this.origin(workspace));
    return items.map((item, index) => {
      const open = workspaces.find(
        (candidate) =>
          resolve(candidate.path) === item.path ||
          resolve(candidate.path).startsWith(`${item.path}${candidate.path.includes("\\") ? "\\" : "/"}`),
      );
      return {
        workspaceId: open?.id,
        name: open?.name,
        path: item.path,
        branch: item.branch,
        head: item.head,
        managed: Boolean(open?.worktreeOf),
        // Git lists the main checkout first.
        main: index === 0,
      };
    });
  }

  /**
   * Deletes a worktree BasedCode created: its folder, Git's record of it and its workspace (whose chats go with it).
   * The branch stays, so committed work is kept. Uncommitted changes block it unless `force`.
   */
  async remove(workspaceId: string, force = false): Promise<{ branch: string; path: string }> {
    const { store, events, workspaces } = this.deps;
    const workspace = store.get("workspace", workspaceId);
    if (!workspace.worktreeOf)
      throw new Error("Only worktrees BasedCode created can be removed this way.");
    this.deps.assertIdle(workspaceId);
    if (!force) {
      const dirty = await gitDirty(workspace);
      if (dirty.length)
        throw new Error(
          `The worktree has ${dirty.length} uncommitted change(s). Commit or discard them first, or remove it with force.`,
        );
    }
    const root = (await this.list(workspace)).find((item) => item.workspaceId === workspaceId)?.path ?? workspace.path;
    const origin = this.origin(workspace);
    await gitWorktreeRemove(origin === workspace ? workspace : origin, root, force);
    await workspaces.remove(workspaceId);
    events.publish("state");
    return { branch: workspace.worktreeOf.branch, path: root };
  }
}
