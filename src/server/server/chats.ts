import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { guidedMode } from "../../shared/chatModes.js";
import type { Chat, ChatMode, Run } from "../../shared/types.js";
import type { Agent } from "../agent/agent.js";
import { expandSlashCommand } from "../agent/commands.js";
import { handOffPrompt } from "../agent/prompts.js";
import type { Events } from "../storage/events.js";
import type { Store } from "../storage/store.js";

const unfinishedRunStatuses = [
  "queued",
  "running",
  "paused",
  "awaiting_approval",
];

export interface ChatDeps {
  store: Store;
  events: Events;
  agent: Pick<Agent, "submit" | "chatBusy">;
  /** Parent folder of the private folders plain chats work in. */
  scratchDirectory: string;
  /** True while a restore or other workspace maintenance runs. */
  inMaintenance: () => boolean;
  /** Deletes a plain chat's folder once no chat uses it. */
  removeUnusedScratch: (workspaceId: string) => Promise<boolean>;
}

/** Chat lifecycle RPCs: create, fork, hand off, wrap up, archive, pin, move, rename and delete. */
export class Chats {
  constructor(private readonly deps: ChatDeps) {}

  async create(input: {
    workspaceId?: string;
    scratch: boolean;
    mode?: ChatMode;
  }): Promise<Chat> {
    const { store, events } = this.deps;
    const chatId = randomUUID();

    let workspaceId = input.workspaceId;
    if (input.scratch) {
      // A plain chat works in its own folder inside app data, so it never touches a project.
      const folder = join(this.deps.scratchDirectory, chatId);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      workspaceId = store.put("workspace", {
        id: randomUUID(),
        path: await realpath(folder),
        name: "Chat",
        scratch: true,
        lastOpenedAt: new Date().toISOString(),
        settings: store.newWorkspaceSettings(),
      }).id;
    }
    if (!workspaceId)
      throw new Error("Choose a workspace or create a plain chat.");

    const target = store.get("workspace", workspaceId);
    // An explicit mode wins; otherwise the workspace's default for new chats.
    const mode = input.mode ?? target.settings.defaultMode ?? "default";
    const chat = store.put("chat", {
      id: chatId,
      workspaceId,
      title: guidedMode(mode)?.title ?? "New chat",
      createdAt: new Date().toISOString(),
      stale: false,
      mode,
    });
    events.publish("state");
    return chat;
  }

  async wrapUp(chatId: string): Promise<Run> {
    const { store, events, agent } = this.deps;
    if (this.deps.inMaintenance())
      throw new Error("Workspace maintenance is in progress.");

    const chat = store.get("chat", chatId);
    const wrapUpPrompt = guidedMode(chat.mode)?.wrapUpPrompt;
    if (!wrapUpPrompt)
      throw new Error("Only guided-mode chats can be wrapped up.");
    if (chat.wrappedUpAt)
      throw new Error("This session was already wrapped up.");

    const run = await agent.submit(chatId, wrapUpPrompt, []);
    store.put("chat", {
      ...store.get("chat", chatId),
      wrappedUpAt: new Date().toISOString(),
    });
    events.publish("state");
    return run;
  }

  archive(chatId: string, archived: boolean): void {
    const { store, events } = this.deps;
    const chat = store.get("chat", chatId);
    store.put("chat", {
      ...chat,
      archivedAt: archived ? new Date().toISOString() : undefined,
    });
    events.publish("state");
  }

  pin(chatId: string, pinned: boolean): void {
    const { store, events } = this.deps;
    store.put("chat", { ...store.get("chat", chatId), pinned });
    events.publish("state");
  }

  move(chatId: string, workspaceId: string): Chat {
    const { store, events } = this.deps;
    const chat = store.get("chat", chatId);
    const target = store.get("workspace", workspaceId);
    if (chat.workspaceId === workspaceId) return chat;
    if (this.hasActiveWork(chatId))
      throw new Error("Stop active and queued prompts before moving this chat.");

    // Earlier turns keep their own workspace, so reverting them still restores the folder they changed.
    const moved = store.put("chat", { ...chat, workspaceId: target.id });
    events.publish("state");
    return moved;
  }

  /** With `prompt`: edit and resend. The fork stops before that prompt and sends the edited text instead. */
  async fork(chatId: string, runId: string, prompt?: string): Promise<Chat> {
    const { store, events, agent } = this.deps;
    const source = store.get("chat", chatId);
    const turns = store
      .all("run")
      .filter((run) => run.chatId === chatId && !run.reverted);
    const until = turns.findIndex((run) => run.id === runId);
    if (until < 0) throw new Error("That prompt is not part of this chat.");
    const copied = turns.slice(0, prompt === undefined ? until + 1 : until);
    if (copied.some((run) => unfinishedRunStatuses.includes(run.status)))
      throw new Error("Wait for that prompt to finish before forking from it.");

    const fork = store.transaction(() => {
      const created = store.put("chat", {
        id: randomUUID(),
        workspaceId: source.workspaceId,
        title: `${source.title} (fork)`.slice(0, 150),
        createdAt: new Date().toISOString(),
        stale: false,
        mode: source.mode,
        forkedFrom: source.id,
        ...(source.titleSource ? { titleSource: source.titleSource } : {}),
      });
      this.copyTurns(chatId, created.id, copied);
      return created;
    });

    if (prompt !== undefined) {
      const original = store
        .all("message")
        .find(
          (message) =>
            message.runId === runId &&
            message.role === "user" &&
            !message.metadata.steer,
        );
      const attachments =
        (original?.metadata.attachments as { id: string }[] | undefined) ?? [];
      const workspace = store.get("workspace", fork.workspaceId);
      agent.submit(
        fork.id,
        await expandSlashCommand(prompt, workspace),
        attachments.map((item) => item.id),
      );
    }
    events.publish("state");
    return fork;
  }

  /**
   * Switches this chat to another mode in place and continues it with a hand-off prompt.
   * Works on wrapped-up chats too: switching mode reopens the session.
   */
  handOff(chatId: string, mode: ChatMode, context?: string): Chat {
    const { store, events, agent } = this.deps;
    if (this.deps.inMaintenance())
      throw new Error("Workspace maintenance is in progress.");

    const source = store.get("chat", chatId);
    const from = guidedMode(source.mode)?.label ?? "a normal chat";
    const to = guidedMode(mode)?.label ?? "a normal chat";
    if ((source.mode ?? "default") === mode)
      throw new Error(`This chat is already in ${to}.`);
    const turns = store
      .all("run")
      .filter((run) => run.chatId === source.id && !run.reverted);
    if (turns.some((run) => unfinishedRunStatuses.includes(run.status)))
      throw new Error(
        "Wait for the current prompt to finish before switching modes.",
      );

    const target = store.put("chat", {
      ...source,
      mode,
      wrappedUpAt: undefined,
    });
    agent.submit(target.id, handOffPrompt(from, to, context), [], {
      modeSwitch: { from, to, context },
    });
    events.publish("state");
    return target;
  }

  async delete(chatId: string): Promise<void> {
    const { store, events } = this.deps;
    const chat = store.get("chat", chatId);
    if (this.hasActiveWork(chatId))
      throw new Error(
        "Stop active and queued prompts before deleting this chat.",
      );

    store.put("chat", { ...chat, deletedAt: new Date().toISOString() });
    await this.deps.removeUnusedScratch(chat.workspaceId);
    events.publish("state");
  }

  /** Switching modes is only for a chat that hasn't started: an existing conversation was shaped by its mode. */
  setMode(chatId: string, mode: ChatMode): void {
    const { store, events } = this.deps;
    const chat = store.get("chat", chatId);
    const hasStarted =
      store.all("message").some((message) => message.chatId === chatId) ||
      store.all("run").some((run) => run.chatId === chatId);
    if (hasStarted)
      throw new Error("The mode can only change before the first prompt.");

    // Keep a title the user chose; otherwise follow the new mode's default title.
    const title =
      chat.titleSource === "user"
        ? chat.title
        : (guidedMode(mode)?.title ?? "New chat");
    store.put("chat", { ...chat, mode, title });
    events.publish("state");
  }

  rename(chatId: string, title: string): void {
    const { store, events } = this.deps;
    store.put("chat", {
      ...store.get("chat", chatId),
      title,
      titleSource: "user",
    });
    events.publish("state");
  }

  private hasActiveWork(chatId: string): boolean {
    return (
      this.deps.agent.chatBusy(chatId) ||
      this.deps.store
        .all("run")
        .some((run) => run.chatId === chatId && run.status === "queued")
    );
  }

  /** Copies finished turns and their messages into another chat. */
  private copyTurns(fromChatId: string, toChatId: string, turns: Run[]): void {
    const { store } = this.deps;
    const runIds = new Map<string, string>();
    for (const run of turns) {
      const copy = store.put("run", {
        ...run,
        id: randomUUID(),
        chatId: toChatId,
        forkedFrom: run.forkedFrom ?? run.id,
      });
      runIds.set(run.id, copy.id);
    }
    for (const message of store.all("message")) {
      const newRun = runIds.get(message.runId);
      if (message.chatId !== fromChatId || !newRun || message.metadata.reverted)
        continue;
      store.put("message", {
        ...message,
        id: randomUUID(),
        chatId: toChatId,
        runId: newRun,
      });
    }
  }
}
