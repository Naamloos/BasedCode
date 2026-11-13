import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Workspace, WorkspaceSettings } from "../../shared/types.js";
import type { Agent } from "../agent/agent.js";
import type { Languages } from "../integrations/languages.js";
import type { McpConnections } from "../integrations/mcp.js";
import type { Events } from "../storage/events.js";
import type { Store } from "../storage/store.js";
import { workspacePath } from "../workspace/workspace.js";
import type { serverConfig, settingsSchema } from "./schemas.js";

export interface WorkspaceDeps {
  store: Store;
  events: Events;
  agent: Pick<Agent, "chatBusy">;
  mcp: Pick<McpConnections, "closeWorkspace" | "forgetRemoved">;
  languages: Pick<Languages, "closeWorkspace">;
  /** App data folder; ordinary workspaces may not overlap it. */
  dataDirectory: string;
  /** Throws unless the workspace has no running agent and no restore in progress. */
  assertIdle: (workspaceId: string) => void;
}

/** Workspace lifecycle RPCs: opening, renaming, clearing chats, removing and settings. */
export class Workspaces {
  constructor(private readonly deps: WorkspaceDeps) {}

  async open(path: string): Promise<Workspace> {
    const { store, events } = this.deps;

    // Plain-chat folders live in app data, which ordinary workspaces may not overlap.
    const scratch = store
      .all("workspace")
      .find((workspace) => workspace.scratch && workspace.path === path);
    const canonical =
      scratch?.path ?? (await workspacePath(path, this.deps.dataDirectory));

    const existing = store
      .all("workspace")
      .find((workspace) => workspace.path === canonical);
    if (existing) {
      const opened = store.put("workspace", {
        ...existing,
        removedAt: undefined,
        lastOpenedAt: new Date().toISOString(),
      });
      events.publish("state");
      return opened;
    }

    const workspace = store.put("workspace", {
      id: randomUUID(),
      lastOpenedAt: new Date().toISOString(),
      path: canonical,
      name: canonical.split(/[\\/]/).pop() ?? canonical,
      settings: store.newWorkspaceSettings(),
    });
    events.publish("workspace-opened", workspace);
    events.publish("state");
    return workspace;
  }

  rename(workspaceId: string, name: string): void {
    const { store, events } = this.deps;
    const workspace = store.get("workspace", workspaceId);
    if (workspace.scratch)
      throw new Error("Plain chats cannot be renamed as a workspace.");

    store.put("workspace", { ...workspace, name });
    events.publish("state");
  }

  /** Archives or soft-deletes every chat in the workspace. */
  clearChats(workspaceId: string, deleting: boolean): void {
    const { store, events, agent } = this.deps;
    const workspace = store.get("workspace", workspaceId);
    if (workspace.scratch || workspace.removedAt)
      throw new Error("Select an existing workspace.");

    const owned = store
      .all("chat")
      .filter((chat) => chat.workspaceId === workspaceId && !chat.deletedAt);
    if (deleting) {
      const ownedIds = new Set(owned.map((chat) => chat.id));
      const hasActiveWork =
        owned.some((chat) => agent.chatBusy(chat.id)) ||
        store
          .all("run")
          .some((run) => ownedIds.has(run.chatId) && run.status === "queued");
      if (hasActiveWork)
        throw new Error(
          "Stop active and queued prompts before deleting workspace chats.",
        );
    }

    const now = new Date().toISOString();
    store.transaction(() => {
      for (const chat of owned)
        store.put(
          "chat",
          deleting
            ? { ...chat, deletedAt: now }
            : { ...chat, archivedAt: chat.archivedAt || now },
        );
    });
    events.publish("state");
  }

  /** Removes the workspace and its chats from BasedCode. The folder on disk is never touched. */
  async remove(workspaceId: string): Promise<void> {
    const { store, events, mcp, languages } = this.deps;
    const workspace = store.get("workspace", workspaceId);
    if (workspace.scratch)
      throw new Error("Plain chats are not a removable workspace.");
    this.deps.assertIdle(workspaceId);

    const owned = store
      .all("chat")
      .filter((chat) => chat.workspaceId === workspaceId);
    const ownedIds = new Set(owned.map((chat) => chat.id));
    const hasQueuedRun = store
      .all("run")
      .some((run) => ownedIds.has(run.chatId) && run.status === "queued");
    if (hasQueuedRun)
      throw new Error(
        "Stop queued prompts in this workspace before removing it.",
      );

    await mcp.closeWorkspace(workspaceId);
    languages.closeWorkspace(workspaceId);

    const now = new Date().toISOString();
    for (const chat of owned)
      if (!chat.deletedAt) store.put("chat", { ...chat, deletedAt: now });
    store.put("workspace", { ...workspace, removedAt: now });
    events.publish("state");
  }

  async updateSettings(
    workspaceId: string,
    settings: z.infer<typeof settingsSchema>,
  ): Promise<void> {
    const { store, events, mcp, languages } = this.deps;
    this.deps.assertIdle(workspaceId);
    await mcp.closeWorkspace(workspaceId);
    languages.closeWorkspace(workspaceId);

    const current = store.get("workspace", workspaceId);
    store.put("workspace", {
      ...current,
      settings: {
        ...settings,
        mcpServers: settings.mcpServers ?? current.settings.mcpServers ?? [],
      } as WorkspaceSettings,
    });
    events.publish("state");
  }

  async updateMcpServers(
    workspaceId: string,
    servers: z.infer<typeof serverConfig>[],
  ): Promise<void> {
    const { store, events, mcp } = this.deps;
    this.deps.assertIdle(workspaceId);
    const workspace = store.get("workspace", workspaceId);
    await mcp.closeWorkspace(workspaceId);

    store.put("workspace", {
      ...workspace,
      settings: { ...workspace.settings, mcpServers: servers },
    });
    await mcp.forgetRemoved();
    events.publish("state");
  }
}
