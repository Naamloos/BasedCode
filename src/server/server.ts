import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { previewMediaType } from "../shared/preview.js";
import {
  defaultMcpRegistries,
  effectiveProviders,
  languageOperations,
  type AppEvent,
  type AppState,
  type GlobalSettings,
  type ProviderCatalog,
  type Run,
} from "../shared/types.js";
import { Agent, isTextAttachment } from "./agent/agent.js";
import { expandSlashCommand, skillCommands } from "./agent/commands.js";
import {
  changeGlobalSkill,
  changeWorkspaceSkill,
  listAllSkills,
  maxSkillLength,
  skillDescription,
  skillNamePattern,
  skillSources,
} from "./agent/skills.js";
import { guidedModeIds } from "../shared/chatModes.js";
import { googleFontsCsp } from "./tools/designPickers.js";
import { Languages } from "./integrations/languages.js";
import { McpConnections } from "./integrations/mcp.js";
import {
  McpOAuth,
  mcpSecretKey,
  oauthCallbackPath,
} from "./integrations/mcpAuth.js";
import {
  buildServer,
  fetchServer,
  probeOAuth,
  searchRegistry,
} from "./integrations/mcpRegistry.js";
import { RemoteAccess } from "./integrations/remote.js";
import { antigravityOptions, cliPath, loginStatus } from "./providers/cli.js";
import {
  loginCommand,
  type AntigravityLoginFolders,
} from "./providers/login.js";
import { CodexHome } from "./providers/codexHome.js";
import { Credentials } from "./providers/credentials.js";
import { Limits } from "./providers/limits.js";
import { catalog, discoverModels } from "./providers/models.js";
import { loadPrices } from "./providers/pricing.js";
import { Processes } from "./runtime/processes.js";
import {
  globalSchema,
  id,
  serverConfig,
  settingsSchema,
  workspaceInput,
} from "./server/schemas.js";
import { Features } from "./server/features.js";
import { usageReport } from "./server/usage.js";
import { Updates } from "./server/updates.js";
import { Events } from "./storage/events.js";
import { Store, defaultSettings } from "./storage/store.js";
import { inlineUiDocument } from "./tools/inlineUi.js";
import { answerQuery } from "./tools/queryTools.js";
import { queryDocument } from "./tools/queryUi.js";
import { libraryFile } from "./tools/widgetLibraries.js";
import { CodingTools } from "./tools/tools.js";
import { Checkpoints } from "./workspace/checkpoints.js";
import {
  attachmentLimit,
  browseFolder,
  openInEditor,
  readAttachment,
  workspaceChanges,
} from "./server/files.js";
import { Chats } from "./server/chats.js";
import { Workspaces } from "./server/workspaces.js";
import { Permissions } from "./workspace/permissions.js";
import {
  fileTree,
  isInside,
  readText,
  safePath,
} from "./workspace/workspace.js";

const dataRoot = resolve(
  process.env.BASEDCODE_DATA_DIR ??
    (process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? homedir(), "BasedCode")
      : join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
          "basedcode",
        )),
);
await mkdir(dataRoot, { recursive: true, mode: 0o700 });
const dataDirectory = await realpath(dataRoot);
const token = process.env.BASEDCODE_AUTH ?? randomBytes(32).toString("hex");
const events = new Events();
const updates = new Updates(() => void shutdown());
const store = new Store(join(dataDirectory, "basedcode.sqlite"));
const permissions = new Permissions(store, events);
const processes = new Processes(events, store);
const checkpoints = new Checkpoints(store, join(dataDirectory, "checkpoints"));
/** Prompt checkpoints are git trees, so the UI warns once when git is missing rather than on every prompt. */
const gitInfo = await new Promise<{ available: boolean; version?: string }>(
  (resolve) =>
    execFile(
      "git",
      ["--version"],
      { windowsHide: true, timeout: 10_000 },
      (error, stdout) =>
        resolve(
          error
            ? { available: false }
            : {
                available: true,
                version: String(stdout)
                  .trim()
                  .replace(/^git version /, ""),
              },
        ),
    ),
);
const languages = new Languages(
  permissions,
  processes,
  events,
  store,
  join(dataDirectory, "servers"),
);
const credentials = new Credentials(dataDirectory);
await credentials
  .load()
  .catch((error: unknown) =>
    console.error(
      "Could not read saved credentials:",
      error instanceof Error ? error.message : error,
    ),
  );
const mcp = new McpConnections(
  permissions,
  processes,
  store,
  credentials,
  new McpOAuth(
    credentials,
    () => ownOrigin,
    (url) => events.publish("open-url", url),
  ),
);
const attachmentDirectory = join(dataDirectory, "attachments");
await mkdir(attachmentDirectory, { recursive: true, mode: 0o700 });
const scratchDirectory = join(dataDirectory, "chats");
await mkdir(scratchDirectory, { recursive: true, mode: 0o700 });

function mcpRegistryById(registryId: string) {
  const registry = (store.global().mcpRegistries ?? defaultMcpRegistries).find(
    (item) => item.id === registryId,
  );
  if (!registry?.enabled)
    throw new Error("This MCP registry is not enabled in App settings.");
  return registry;
}

/** Total bytes under a folder; missing folders count as 0. */
async function folderSize(path: string): Promise<number> {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += await folderSize(child);
    else if (entry.isFile())
      total += (await stat(child).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Disk use of app data, for the storage panel. */
async function storageSummary() {
  const scratchChats = store
    .all("workspace")
    .filter(
      (workspace) => workspace.scratch && existsSync(workspace.path),
    ).length;
  return {
    chatsBytes: await folderSize(scratchDirectory),
    checkpointsBytes: await folderSize(join(dataDirectory, "checkpoints")),
    legacyCheckpointsBytes: await folderSize(join(dataDirectory, "objects")),
    attachmentsBytes: await folderSize(attachmentDirectory),
    scratchChats,
  };
}

/**
 * Deletes a non-workspace chat's private folder and checkpoint history once no remaining chat uses it.
 * Returns whether anything was removed.
 */
async function removeUnusedScratch(workspaceId: string): Promise<boolean> {
  const workspace = store
    .all("workspace")
    .find((item) => item.id === workspaceId);
  if (!workspace?.scratch) return false;
  // Only folders whose chats were all deleted. A plain chat moved to a workspace leaves its folder with no
  // chat at all; those files may still matter, so they are kept.
  const owners = store
    .all("chat")
    .filter((chat) => chat.workspaceId === workspaceId);
  if (!owners.length || owners.some((chat) => !chat.deletedAt)) return false;
  // The workspace record stays, so deleted chats and usage history still resolve it.
  if (
    !isInside(scratchDirectory, workspace.path) ||
    !existsSync(workspace.path)
  )
    return false;
  await rm(workspace.path, { recursive: true, force: true });
  await checkpoints.forget(workspace);
  return true;
}
const tools = new CodingTools(
  store,
  events,
  permissions,
  processes,
  languages,
  mcp,
  join(dataDirectory, "servers"),
  attachmentDirectory,
);
const limits = new Limits(store, events);
// Prices for estimating OpenAI model costs; runs before this finishes just go unpriced.
void loadPrices(join(dataDirectory, "model-prices.json"));
const agent = new Agent(
  store,
  events,
  permissions,
  checkpoints,
  processes,
  tools,
  credentials,
  attachmentDirectory,
  limits,
  new CodexHome(join(dataDirectory, "codex-home")),
);
// Refresh diagnostics after every prompt, since the agent may have edited files.
agent.onRunFinished = (workspace, runId) => {
  void languages.scanWorkspace(workspace).catch(() => undefined);
  features.runFinished(runId);
};
/** googleFonts: the font picker, the only built-in view allowed to load Google Fonts. */
const views = new Map<
  string,
  {
    html: string;
    expires: number;
    files?: Set<string>;
    mcp?: boolean;
    googleFonts?: boolean;
  }
>();
const mcpWidgetCsp =
  "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https: blob:; style-src 'unsafe-inline' http: https:; img-src http: https: data: blob:; frame-src 'self' http: https: blob: data:; connect-src http: https: ws: wss:; worker-src http: https: blob:; media-src http: https: data: blob:; font-src http: https: data:; base-uri http: https:; object-src 'none'";

/** Attachment ids the user attached to a chat's own messages; widgets may only load those. */
function chatAttachmentIds(chatId: string): Set<string> {
  const ids = new Set<string>();
  for (const message of store.all("message"))
    if (message.chatId === chatId && message.role === "user")
      for (const item of (message.metadata.attachments as
        { id: string }[] | undefined) ?? [])
        ids.add(item.id);
  return ids;
}

function widgetFileType(name: string): string {
  if (/\.wasm$/i.test(name)) return "application/wasm";
  if (/\.m?js$/i.test(name)) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
// Recent events for long-polling clients. Cloudflare quick tunnels don't pass Server-Sent Events through.
const recentEvents: { seq: number; event: AppEvent }[] = [];
let eventSeq = 0;
events.on("event", (event: AppEvent) => {
  // Keep only the latest transient frame per run, rather than hundreds of JPEGs.
  if (event.type === "browser-preview") {
    const previous = recentEvents.findIndex(
      (item) =>
        item.event.type === "browser-preview" &&
        item.event.runId === event.runId,
    );
    if (previous >= 0) recentEvents.splice(previous, 1);
  }
  recentEvents.push({ seq: ++eventSeq, event });
  if (recentEvents.length > 500) recentEvents.shift();
});
// The newest live browser frame per chat, so a viewer that connects mid-session starts with a picture.
const browserFrames = new Map<string, Buffer>();
events.on("frame", (chatId: string, image: Buffer) => browserFrames.set(chatId, image));
events.on("frame-end", (chatId: string) => browserFrames.delete(chatId));
let maintenance = false;
let ownOrigin = "";


function state(): AppState & { recoveryRequired: boolean } {
  const chats = store.all("chat");
  const deletedChats = new Set(
    chats.filter((chat) => chat.deletedAt).map((chat) => chat.id),
  );
  return {
    workspaces: store
      .all("workspace")
      .filter((workspace) => !workspace.removedAt),
    chats: chats.filter((chat) => !chat.deletedAt),
    runs: store
      .all("run")
      .filter((run) => !run.reverted && !deletedChats.has(run.chatId)),
    messages: store
      .all("message")
      .filter(
        (message) =>
          !message.metadata.reverted && !deletedChats.has(message.chatId),
      ),
    approvals: store
      .all("approval")
      .filter((approval) => approval.status === "pending"),
    actions: store.all("action"),
    terminals: processes.list(),
    diagnostics: languages.list(),
    sandbox: processes.sandbox,
    git: gitInfo,
    global: store.global(),
    credentials: { saved: credentials.list(), storage: credentials.storage },
    limits: limits.list(),
    comparisons: store.all("comparison"),
    recoveryRequired: checkpoints.hasRecovery,
  };
}

/** Forked copies have no checkpoint, and a revert must not span turns that ran in different folders. */
function assertRevertible(run: Run): void {
  if (run.forkedFrom)
    throw new Error(
      "This turn was copied into a fork. Revert it in the original chat.",
    );
  const turns = store
    .all("run")
    .filter((item) => item.chatId === run.chatId && !item.reverted);
  const later = turns.slice(turns.findIndex((item) => item.id === run.id));
  if (later.some((item) => item.workspaceId !== run.workspaceId))
    throw new Error(
      "This chat was moved to another workspace after this prompt. Only prompts since the move can be reverted.",
    );
}

function assertIdle(workspaceId: string): void {
  if (maintenance || agent.busy(store.get("workspace", workspaceId)))
    throw new Error("Stop the active agent before changing workspace state.");
  if (checkpoints.hasRecovery)
    throw new Error("Recover the interrupted restore first.");
}

/** Workspace-changing feature work (re-run, keep, rewind): one at a time, with scheduling paused. */
async function inMaintenance<T>(work: () => Promise<T>): Promise<T> {
  if (maintenance) throw new Error("Another restore is in progress.");
  maintenance = true;
  agent.suspendScheduling();
  try {
    return await work();
  } finally {
    maintenance = false;
    agent.resumeScheduling();
  }
}

const features = new Features({
  store,
  events,
  agent,
  checkpoints,
  permissions,
  // Inside inMaintenance the flag is ours, so only the agent and recovery checks apply.
  assertIdle: (workspaceId) => {
    if (agent.busy(store.get("workspace", workspaceId)))
      throw new Error("Stop the active agent before changing workspace state.");
    if (checkpoints.hasRecovery)
      throw new Error("Recover the interrupted restore first.");
  },
  assertRevertible,
  maintenance: inMaintenance,
  hooksDirectory: join(dataDirectory, "servers", "empty-git-hooks"),
});
features.attachNotifications();

const chats = new Chats({
  store,
  events,
  agent,
  scratchDirectory,
  inMaintenance: () => maintenance,
  removeUnusedScratch,
});

const workspaces = new Workspaces({
  store,
  events,
  agent,
  mcp,
  languages,
  dataDirectory,
  assertIdle,
});

/**
 * Methods that change a chat, its history or its files. A wrapped-up chat is locked, so these are
 * refused for it. Reading, second opinions, stopping the wrap-up run, and archive/pin/move/delete still work.
 */
const lockedChatMethods = new Set([
  "run.submit",
  "run.steer",
  "run.rerun",
  "compare.keep",
  "chat.provider",
  "chat.handoff",
  "chat.rename",
  "chat.setMode",
  "chat.compact",
  "context.flag",
  "rewind.preview",
  "rewind.apply",
  "revert.preview",
  "revert.apply",
  "attachment.upload",
]);

/** Finds the chat a request is about from its chatId, runId or messageId, if it names one. */
function requestChat(params: unknown) {
  if (!params || typeof params !== "object") return undefined;
  const { chatId, runId, messageId } = params as Record<string, unknown>;
  try {
    if (typeof chatId === "string") return store.get("chat", chatId);
    if (typeof runId === "string")
      return store.get("chat", store.get("run", runId).chatId);
    if (typeof messageId === "string")
      return store.get("chat", store.get("message", messageId).chatId);
  } catch {
    // Unknown ids fail in the handler itself, with its own error.
  }
  return undefined;
}

function assertChatUnlocked(method: string, params: unknown) {
  if (lockedChatMethods.has(method) && requestChat(params)?.wrappedUpAt)
    throw new Error("This session was wrapped up and is locked.");
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  assertChatUnlocked(method, params);
  switch (method) {
    case "review.start":
      return features.startReview(params);
    case "run.rerun":
      return features.rerun(params);
    case "compare.get":
      return features.comparison(params);
    case "compare.keep":
      return features.keep(params);
    case "chat.provider":
      return features.setChatProvider(params);
    case "chat.handoff":
      return features.handoff(params);
    case "context.inspect":
      return features.inspect(params);
    case "context.flag":
      return features.flag(params);
    case "rewind.preview":
      return features.rewindPreview(params);
    case "rewind.apply":
      return features.rewind(params);
    case "pr.describe":
      return features.prDescription(params);
    case "git.status":
      return features.gitStatus(params);
    case "git.stage":
      return features.gitStage(params);
    case "git.commit":
      return features.gitCommit(params);
    case "git.push":
      return features.gitPush(params);
    case "git.message":
      return features.gitMessage(params);
    case "notifications.test":
      return features.testNotification();
    case "state":
      return state();
    case "welcome.dismiss": {
      store.saveGlobal({ ...store.global(), welcomeDismissed: true });
      events.publish("state");
      return null;
    }
    case "tools.catalog":
      return tools.catalog();
    case "update.status":
      return updates.status();
    case "update.check":
      return updates.check();
    case "update.install":
      await updates.install();
      return null;
    case "external.open": {
      const { url: target } = z.object({ url: z.url() }).parse(params);
      const url = new URL(target);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Only HTTP(S) links can open externally.");
      events.publish("open-url", url.href);
      return null;
    }
    case "workspace.pick":
      events.publish("pick-folder");
      return null;
    // Human file-picker operations: these RPCs are not exposed as agent tools.
    case "filesystem.browse": {
      const { path, directoriesOnly } = z
        .object({
          path: z.string().default(homedir()),
          directoriesOnly: z.boolean().default(false),
        })
        .parse(params);
      return browseFolder(path, directoriesOnly);
    }
    case "filesystem.readAttachment": {
      const { path } = z.object({ path: z.string().min(1) }).parse(params);
      return readAttachment(path);
    }
    case "workspace.open": {
      const { path } = z.object({ path: z.string().min(1) }).parse(params);
      return workspaces.open(path);
    }
    case "workspace.rename": {
      const { workspaceId, name } = z
        .object({ workspaceId: id, name: z.string().trim().min(1).max(80) })
        .parse(params);
      workspaces.rename(workspaceId, name);
      return null;
    }
    case "workspace.chats.archive":
    case "workspace.chats.delete": {
      const { workspaceId } = z.object({ workspaceId: id }).parse(params);
      workspaces.clearChats(workspaceId, method === "workspace.chats.delete");
      return null;
    }
    case "workspace.remove": {
      const { workspaceId } = z.object({ workspaceId: id }).parse(params);
      await workspaces.remove(workspaceId);
      return null;
    }
    case "workspace.settings": {
      const { workspaceId, settings } = z
        .object({ workspaceId: id, settings: settingsSchema })
        .parse(params);
      await workspaces.updateSettings(workspaceId, settings);
      return null;
    }
    case "workspace.mcpSettings": {
      const { workspaceId, servers } = z
        .object({ workspaceId: id, servers: z.array(serverConfig).max(30) })
        .parse(params);
      await workspaces.updateMcpServers(workspaceId, servers);
      return null;
    }
    case "global.settings": {
      const { settings } = z.object({ settings: globalSchema }).parse(params);
      const previous = store.global();
      if (
        JSON.stringify(previous.languageServers) !==
        JSON.stringify(settings.languageServers)
      ) {
        for (const workspace of store.all("workspace"))
          assertIdle(workspace.id);
        await mcp.close();
        languages.close();
        events.publish("diagnostics", languages.list());
      } else if (
        JSON.stringify(previous.mcpServers) !==
        JSON.stringify(settings.mcpServers)
      ) {
        // Changed configs reconnect on next use; removed or disabled ones must not stay connected.
        await mcp.close();
      }
      store.saveGlobal(settings as GlobalSettings);
      // Credentials of removed connections go with them. MCP secrets are keyed `mcp:<server>:...`.
      for (const saved of credentials.list())
        if (
          !saved.startsWith("mcp:") &&
          !settings.providers.some((provider) => provider.id === saved)
        )
          await credentials.remove(saved);
      await mcp.forgetRemoved();
      events.publish("state");
      return null;
    }
    case "global.defaults": {
      // Starting point for the "new workspace" template: the built-in defaults, for resetting it.
      return defaultSettings();
    }
    case "provider.credential": {
      const { providerId, value } = z
        .object({ providerId: z.string(), value: z.string().max(10_000) })
        .parse(params);
      if (
        !store.global().providers.some((provider) => provider.id === providerId)
      )
        throw new Error("Unknown provider connection.");
      await credentials.set(providerId, value);
      events.publish("state");
      return null;
    }
    case "provider.models": {
      const { providerId } = z.object({ providerId: z.string() }).parse(params);
      const provider = store
        .global()
        .providers.find((provider) => provider.id === providerId);
      if (provider?.kind === "antigravity")
        return (await catalog(provider, store.global(), 2500, true)).map((model) => model.id);
      if (
        !provider ||
        !["ollama", "lmstudio", "openai"].includes(provider.kind)
      )
        throw new Error(
          "Model discovery is supported for Ollama, LM Studio and OpenAI-compatible endpoints.",
        );
      const listed = discoverModels(
        provider.endpoint,
        await credentials.get(provider.id),
      );
      // Many OpenAI-compatible services do not list models; let the service pick its own.
      return provider.kind === "openai"
        ? listed.catch(() => ["default"])
        : listed;
    }
    case "provider.catalog": {
      // Models per configured provider for the composer's picker; one unreachable service does not hide the others.
      const { refresh } = z
        .object({ refresh: z.boolean().default(false) })
        .parse(params);
      const global = store.global();
      return Promise.all(
        global.providers.map(async (provider): Promise<ProviderCatalog> => {
          try {
            return {
              providerId: provider.id,
              models: await catalog(
                provider,
                global,
                2500,
                refresh,
                await credentials.get(provider.id),
              ),
            };
          } catch (error) {
            return {
              providerId: provider.id,
              models: [],
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );
    }
    case "remote.status":
      return remote.current;
    case "remote.start": {
      // The settings panel passes its unsaved path so Start works before Save.
      const { cloudflaredPath } = z
        .object({ cloudflaredPath: z.string().max(1000).optional() })
        .parse(params);
      return remote.start(
        cloudflaredPath ?? store.global().cloudflaredPath ?? "",
      );
    }
    case "remote.stop":
      return remote.stop();
    case "provider.auth": {
      const { kind } = z
        .object({ kind: z.enum(["codex", "claude", "antigravity"]) })
        .parse(params);
      const global = store.global();
      return loginStatus(kind, global[`${kind}Path`] ?? "");
    }
    case "provider.login": {
      const { workspaceId, provider } = z
        .object({
          workspaceId: id,
          provider: z.enum(["codex", "claude", "antigravity"]),
        })
        .parse(params);
      assertIdle(workspaceId);
      const workspace = store.get("workspace", workspaceId);
      const global = store.global();
      const executable = cliPath(provider, global[`${provider}Path`] ?? "");
      let antigravityFolders: AntigravityLoginFolders | undefined;
      if (provider === "antigravity") {
        const { runtimeDir } = antigravityOptions(global.antigravityPath);
        antigravityFolders = {
          home: join(runtimeDir, "home"),
          cwd: join(runtimeDir, "workspace"),
        };
        await mkdir(antigravityFolders.home, { recursive: true });
        await mkdir(antigravityFolders.cwd, { recursive: true });
      }
      const command = loginCommand(
        provider,
        executable,
        process.platform,
        antigravityFolders,
      );
      await permissions.ask(
        workspaceId,
        `Sign in to ${provider}`,
        `Run ${command} in an interactive terminal using your existing CLI. This opens the provider's supported sign-in flow. ${processes.sandbox.detail}`,
      );
      return processes.create(workspace, command, undefined, true);
    }
    case "chat.create": {
      const input = z
        .object({
          workspaceId: id.optional(),
          scratch: z.boolean().default(false),
          mode: z.enum(["default", ...guidedModeIds]).optional(),
        })
        .parse(params);
      return chats.create(input);
    }
    case "chat.wrapUp": {
      const { chatId } = z.object({ chatId: id }).parse(params);
      return chats.wrapUp(chatId);
    }
    case "chat.archive": {
      const { chatId, archived } = z
        .object({ chatId: id, archived: z.boolean() })
        .parse(params);
      chats.archive(chatId, archived);
      return null;
    }
    case "chat.pin": {
      const { chatId, pinned } = z
        .object({ chatId: id, pinned: z.boolean() })
        .parse(params);
      chats.pin(chatId, pinned);
      return null;
    }
    case "chat.move": {
      const { chatId, workspaceId } = z
        .object({ chatId: id, workspaceId: id })
        .parse(params);
      return chats.move(chatId, workspaceId);
    }
    case "chat.fork": {
      const { chatId, runId, prompt } = z
        .object({
          chatId: id,
          runId: id,
          prompt: z.string().trim().min(1).max(100_000).optional(),
        })
        .parse(params);
      return chats.fork(chatId, runId, prompt);
    }
    case "chat.handOff": {
      const input = z
        .object({
          chatId: id,
          mode: z.enum(["default", ...guidedModeIds]),
          context: z.string().trim().max(20_000).optional(),
        })
        .parse(params);
      return chats.handOff(input.chatId, input.mode, input.context || undefined);
    }
    case "chat.delete": {
      const { chatId } = z.object({ chatId: id }).parse(params);
      await chats.delete(chatId);
      return null;
    }
    case "chat.setMode": {
      const { chatId, mode } = z
        .object({ chatId: id, mode: z.enum(["default", ...guidedModeIds]) })
        .parse(params);
      chats.setMode(chatId, mode);
      return null;
    }
    case "chat.rename": {
      const { chatId, title } = z
        .object({ chatId: id, title: z.string().min(1).max(150) })
        .parse(params);
      chats.rename(chatId, title);
      return null;
    }
    case "skills.list": {
      // Every skill in every folder, shadowed ones included, so settings can show where each one lives.
      const { workspaceId } = z.object({ workspaceId: id.optional() }).parse(params);
      const workspace = workspaceId ? store.get("workspace", workspaceId) : undefined;
      const winners = new Set<string>();
      return (await listAllSkills(workspace)).map((skill) => {
        const active = !winners.has(skill.name);
        winners.add(skill.name);
        return { ...skill, description: skillDescription(skill.content), active };
      });
    }
    case "skills.save":
    case "skills.delete": {
      const { workspaceId, scope, source, name, content, expectedContent } = z
        .object({
          workspaceId: id.optional(),
          scope: z.enum(["workspace", "global"]).default("workspace"),
          source: z.enum(skillSources).default("basedcode"),
          name: z.string().regex(skillNamePattern).max(64),
          content: z.string().min(1).max(maxSkillLength).optional(),
          expectedContent: z.string().optional(),
        })
        .parse(params);
      if (method === "skills.save" && content === undefined)
        throw new Error("Skill instructions are required.");
      const change = method === "skills.delete" ? undefined : content;
      if (scope === "global") {
        await changeGlobalSkill(source, name, change, expectedContent);
        events.publish("state");
        return null;
      }
      if (!workspaceId) throw new Error("Open a workspace to change its skills.");
      assertIdle(workspaceId);
      const { path } = await changeWorkspaceSkill(
        store.get("workspace", workspaceId),
        source,
        name,
        change,
        expectedContent,
      );
      events.publish("files-changed", { path }, workspaceId);
      return null;
    }
    case "skills.commands": {
      const { workspaceId } = workspaceInput.parse(params);
      return skillCommands(store.get("workspace", workspaceId));
    }
    case "run.submit": {
      const { chatId, prompt, attachmentIds } = z
        .object({
          chatId: id,
          prompt: z.string().trim().min(1).max(100_000),
          attachmentIds: z.array(id).max(20).default([]),
        })
        .parse(params);
      if (maintenance) throw new Error("Workspace maintenance is in progress.");
      const chat = store.get("chat", chatId);
      // Picking an archived chat back up brings it back to its workspace group.
      if (chat.archivedAt)
        store.put("chat", { ...chat, archivedAt: undefined });
      const workspace = store.get("workspace", chat.workspaceId);
      return agent.submit(
        chatId,
        await expandSlashCommand(prompt, workspace),
        attachmentIds,
      );
    }
    case "run.steer": {
      const { runId, prompt, attachmentIds } = z
        .object({
          runId: id,
          prompt: z.string().trim().min(1).max(100_000),
          attachmentIds: z.array(id).max(20).default([]),
        })
        .parse(params);
      const run = store.get("run", runId);
      const chat = store.get("chat", run.chatId);
      const workspace = store.get("workspace", chat.workspaceId);
      agent.steer(
        runId,
        await expandSlashCommand(prompt, workspace),
        attachmentIds,
      );
      return null;
    }
    case "chat.compact": {
      const { chatId } = z.object({ chatId: id }).parse(params);
      const chat = store.get("chat", chatId);
      const workspace = store.get("workspace", chat.workspaceId);
      if (agent.chatBusy(chatId))
        throw new Error(
          "Wait for this chat's prompt to finish before compacting.",
        );
      const provider = effectiveProviders(store.global(), workspace).find(
        (item) => item.enabled,
      );
      if (!provider) throw new Error("Enable a provider to write the summary.");
      await agent.compact(
        chatId,
        provider,
        workspace,
        undefined,
        undefined,
        true,
      );
      return null;
    }
    case "attachment.upload": {
      const { name, mediaType, data } = z
        .object({
          name: z.string().min(1).max(255),
          mediaType: z.string().max(200),
          data: z.string(),
        })
        .parse(params);
      const bytes = Buffer.from(data, "base64");
      if (bytes.length > attachmentLimit)
        throw new Error("Attachments are limited to 20 MiB each.");
      const attachment = store.put("attachment", {
        id: randomUUID(),
        name: name.replace(/[\\/]/g, "_"),
        mediaType: /^[\w.+-]+\/[\w.+-]+$/.test(mediaType)
          ? mediaType
          : "application/octet-stream",
        size: bytes.length,
        createdAt: new Date().toISOString(),
      });
      await writeFile(join(attachmentDirectory, attachment.id), bytes, {
        mode: 0o600,
      });
      return attachment;
    }
    case "storage.summary":
      return storageSummary();
    case "storage.cleanup": {
      let removed = 0;
      for (const workspace of store.all("workspace"))
        if (workspace.scratch && (await removeUnusedScratch(workspace.id)))
          removed++;
      events.publish("state");
      return { removed, ...(await storageSummary()) };
    }
    case "storage.removeLegacyCheckpoints": {
      // Pre-git checkpoints can no longer be shown or reverted; this frees their snapshot files.
      await rm(join(dataDirectory, "objects"), {
        recursive: true,
        force: true,
      });
      return storageSummary();
    }
    case "usage.summary": {
      const range = z
        .object({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .parse(params ?? {});
      return usageReport(store, range);
    }
    case "limits.refresh": {
      // Codex reads are free; the Claude check sends one tiny Haiku request, so the UI only does it on request.
      const { kind } = z
        .object({ kind: z.enum(["codex", "claude", "antigravity"]) })
        .parse(params);
      const global = store.global();
      if (kind === "antigravity")
        return limits.refreshAntigravity(global.antigravityPath);
      return kind === "codex"
        ? limits.refreshCodex(global.codexPath)
        : limits.refreshClaude(global.claudePath);
    }
    case "run.stop":
      await agent.stop(z.object({ runId: id }).parse(params).runId);
      return null;
    case "approval.decide": {
      const { approvalId, approved, remember } = z
        .object({
          approvalId: id,
          approved: z.boolean(),
          remember: z.boolean().optional(),
        })
        .parse(params);
      permissions.decide(approvalId, approved, remember);
      return null;
    }
    case "files.list": {
      const { workspaceId, path } = z
        .object({ workspaceId: id, path: z.string().default(".") })
        .parse(params);
      return fileTree(store.get("workspace", workspaceId), path);
    }
    case "files.read": {
      const { workspaceId, path } = z
        .object({ workspaceId: id, path: z.string() })
        .parse(params);
      const workspace = store.get("workspace", workspaceId);
      const mediaType = previewMediaType(path);
      if (mediaType) {
        const file = await safePath(workspace, path);
        if (!(await stat(file)).isFile())
          throw new Error("Select a regular file.");
        return { content: "", binary: true, mediaType };
      }
      const result = await readText(workspace, path);
      try {
        await languages.changed(workspace, path);
      } catch (error) {
        events.publish(
          "notice",
          `Preview loaded; language server refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          workspaceId,
        );
      }
      return result;
    }
    case "files.snippet": {
      // Plain read for diagnostic snippets: unlike files.read it does not notify language servers, which would republish
      // diagnostics and make the page reload its snippets in a loop.
      const { workspaceId, path } = z
        .object({ workspaceId: id, path: z.string() })
        .parse(params);
      return readText(store.get("workspace", workspaceId), path);
    }
    case "files.openExternal": {
      const { workspaceId, path, line, column } = z
        .object({
          workspaceId: id,
          path: z.string().default("."),
          line: z.number().int().min(1).optional(),
          column: z.number().int().min(1).optional(),
        })
        .parse(params);
      const workspace = store.get("workspace", workspaceId);
      await openInEditor(workspace, await safePath(workspace, path), line, column);
      return null;
    }
    case "changes": {
      const { workspaceId, runId, scope } = z
        .object({
          workspaceId: id,
          runId: id.optional(),
          scope: z.enum(["prompt", "workspace"]),
        })
        .parse(params);
      const workspace = store.get("workspace", workspaceId);
      if (scope === "workspace") return workspaceChanges(workspace);
      if (!runId) return { changes: [] };
      if (store.get("run", runId).workspaceId !== workspaceId)
        throw new Error("Prompt belongs to a different workspace.");
      return { changes: await checkpoints.changes(workspace, runId) };
    }
    case "revert.preview": {
      const { runId } = z.object({ runId: id }).parse(params);
      const run = store.get("run", runId);
      assertRevertible(run);
      const workspace = store.get("workspace", run.workspaceId);
      if (agent.busy(workspace))
        throw new Error("Stop the active agent before previewing revert.");
      const { paths, conflicts, actions } = await checkpoints.previewRevert(
        workspace,
        run,
      );
      return { paths, conflicts, actions };
    }
    case "revert.apply": {
      const { runId } = z.object({ runId: id }).parse(params);
      return inMaintenance(async () => {
        const run = store.get("run", runId);
        assertRevertible(run);
        const workspace = store.get("workspace", run.workspaceId);
        if (agent.busy(workspace))
          throw new Error("Stop running agents before reverting.");

        // Reverting a turn also reverts every later turn in the chat.
        const turns = store
          .all("run")
          .filter((item) => item.chatId === run.chatId && !item.reverted);
        const affected = new Set(
          turns
            .slice(turns.findIndex((item) => item.id === run.id))
            .map((item) => item.id),
        );
        await processes.stopRuns(affected);
        const hasRunningTerminal = processes
          .list()
          .some(
            (terminal) =>
              terminal.workspaceId === workspace.id &&
              terminal.status === "running",
          );
        if (hasRunningTerminal)
          throw new Error(
            "Stop other workspace terminals and services before reverting.",
          );

        await mcp.closeWorkspace(workspace.id);
        languages.closeWorkspace(workspace.id);
        const prompt = await checkpoints.revert(workspace, run);
        events.publish("state");
        events.publish("files-changed", null, workspace.id);
        return { prompt };
      });
    }
    case "restore.recover": {
      if (maintenance) throw new Error("Workspace maintenance is in progress.");
      maintenance = true;
      agent.suspendScheduling();
      try {
        await checkpoints.recover();
        events.publish("state");
        return null;
      } finally {
        maintenance = false;
        agent.resumeScheduling();
      }
    }
    case "terminal.create": {
      const { workspaceId } = workspaceInput.parse(params);
      // The user's own click authorizes their own shell (like opening an external editor); the panel labels its scope.
      return processes.create(store.get("workspace", workspaceId));
    }
    case "terminal.write": {
      const { terminalId, data } = z
        .object({ terminalId: id, data: z.string().max(20_000) })
        .parse(params);
      processes.write(terminalId, data, "user");
      return null;
    }
    case "terminal.resize": {
      const { terminalId, cols, rows } = z
        .object({
          terminalId: id,
          cols: z.number().int(),
          rows: z.number().int(),
        })
        .parse(params);
      processes.resize(terminalId, cols, rows);
      return null;
    }
    case "browser.close": {
      const { chatId } = z.object({ chatId: id }).parse(params);
      await events.closeBrowser(chatId);
      return null;
    }
    case "terminal.stop":
      processes.stop(z.object({ terminalId: id }).parse(params).terminalId, true);
      return null;
    case "terminal.close":
      await processes.close(
        z.object({ terminalId: id }).parse(params).terminalId,
        true,
      );
      return null;
    case "terminal.control": {
      const { terminalId, owner } = z
        .object({ terminalId: id, owner: z.enum(["user", "agent"]) })
        .parse(params);
      processes.takeover(terminalId, owner);
      agent.syncTerminalControl(processes.info(terminalId).runId);
      return null;
    }
    case "language.discover": {
      const { workspaceId } = z.object({ workspaceId: id }).parse(params);
      return languages.discoverServers(store.get("workspace", workspaceId));
    }
    case "language.setup": {
      const { workspaceId, serverId } = z
        .object({ workspaceId: id, serverId: z.string() })
        .parse(params);
      return languages.setup(store.get("workspace", workspaceId), serverId);
    }
    case "language.scan": {
      // Results arrive through 'diagnostics' events.
      const { workspaceId, wait } = z
        .object({ workspaceId: id, wait: z.boolean().default(false) })
        .parse(params);
      const scan = languages.scanWorkspace(store.get("workspace", workspaceId));
      if (wait) await scan;
      else void scan.catch(() => undefined);
      return null;
    }
    case "language.query": {
      const { workspaceId, path, operation, line, character } = z
        .object({
          workspaceId: id,
          path: z.string(),
          operation: z.enum(languageOperations),
          line: z.number().int().min(0).default(0),
          character: z.number().int().min(0).default(0),
        })
        .parse(params);
      return languages.query(
        store.get("workspace", workspaceId),
        path,
        operation,
        line,
        character,
      );
    }
    case "mcp.registry.search": {
      const { registryId, search, cursor } = z
        .object({
          registryId: z.string(),
          search: z.string().max(200),
          cursor: z.string().max(500).optional(),
        })
        .parse(params);
      return searchRegistry(mcpRegistryById(registryId), search, cursor);
    }
    case "mcp.registry.install": {
      const { registryId, name, version, optionId, values, auth } = z
        .object({
          registryId: z.string(),
          name: z.string().max(300),
          version: z.string().max(100),
          optionId: z.string().max(50),
          values: z.record(z.string().max(300), z.string().max(4000)),
          auth: z.enum(["auto", "none", "oauth"]).default("auto"),
        })
        .parse(params);
      // Install from the registry's own record of this version, not from what the UI sent back.
      const entry = await fetchServer(
        mcpRegistryById(registryId),
        name,
        version,
      );
      const { config, secrets } = buildServer(
        registryId,
        entry,
        optionId,
        values,
      );
      if (config.transport !== "stdio") {
        if (auth !== "auto") {
          config.auth = auth;
        } else {
          // Servers that already carry credentials in headers never need OAuth; others say so when probed.
          const hasHeaderCredentials = Boolean(
            config.secretHeaders?.length || config.headers,
          );
          const offersOAuth =
            !hasHeaderCredentials && (await probeOAuth(config.url!));
          config.auth = offersOAuth ? "oauth" : "none";
        }
      }
      for (const [key, value] of Object.entries(secrets))
        await credentials.set(mcpSecretKey(config.id, key), value);
      const global = store.global();
      store.saveGlobal({
        ...global,
        mcpServers: [...global.mcpServers, config],
      });
      events.publish("state");
      return config;
    }
    case "mcp.status": {
      const { workspaceId } = z
        .object({ workspaceId: id.optional() })
        .parse(params);
      return mcp.status([
        ...store.global().mcpServers,
        ...(workspaceId
          ? (store.get("workspace", workspaceId).settings.mcpServers ?? [])
          : []),
      ]);
    }
    case "mcp.secret": {
      const { serverId, name, value } = z
        .object({
          serverId: z.string().min(1).max(100),
          name: z
            .string()
            .regex(
              /^(env\.[A-Za-z_][A-Za-z0-9_]*|header\.[A-Za-z0-9-]+|oauthClientSecret)$/,
            ),
          value: z.string().max(8000),
        })
        .parse(params);
      await credentials.set(mcpSecretKey(serverId, name), value);
      await mcp.close();
      return null;
    }
    case "mcp.oauth.signIn": {
      const { serverId, workspaceId } = z
        .object({ serverId: z.string(), workspaceId: id.optional() })
        .parse(params);
      const server =
        (workspaceId
          ? store
              .get("workspace", workspaceId)
              .settings.mcpServers?.find((item) => item.id === serverId)
          : undefined) ??
        store.global().mcpServers.find((item) => item.id === serverId);
      if (!server) throw new Error("MCP server is not configured.");
      await mcp.oauth.signIn(server);
      await mcp.close();
      events.publish("state");
      return null;
    }
    case "mcp.oauth.signOut": {
      const { serverId } = z.object({ serverId: z.string() }).parse(params);
      await mcp.oauth.signOut(serverId);
      await mcp.close();
      return null;
    }
    case "mcp.discover": {
      const { workspaceId, serverId } = z
        .object({ workspaceId: id, serverId: z.string() })
        .parse(params);
      return mcp.discover(store.get("workspace", workspaceId), serverId);
    }
    case "mcp.call": {
      const {
        messageId,
        workspaceId,
        serverId,
        name,
        arguments: args,
      } = z
        .object({
          messageId: id,
          workspaceId: id,
          serverId: z.string(),
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()),
        })
        .parse(params);
      const message = store.get("message", messageId);
      const chat = store.get("chat", message.chatId);
      const tool = message.metadata.tool as
        | {
            name?: string;
            args?: { serverId?: string };
            result?: { app?: { serverId?: string } };
          }
        | undefined;
      if (
        chat.deletedAt ||
        message.metadata.reverted ||
        chat.workspaceId !== workspaceId ||
        tool?.name !== "call_mcp" ||
        (tool.result?.app?.serverId ?? tool.args?.serverId) !== serverId
      )
        throw new Error("This embedded app cannot call this MCP server.");
      assertIdle(workspaceId);
      const workspace = store.get("workspace", workspaceId);
      const run = store.get("run", message.runId);
      const result = await mcp.call(
        workspace,
        serverId,
        name,
        args,
        undefined,
        run,
        true,
      );
      events.publish("state");
      return result.result;
    }
    case "query.answer": {
      const { messageId, value } = z
        .object({ messageId: id, value: z.unknown() })
        .parse(params);
      const message = store.get("message", messageId);
      const tool = message.metadata.tool as
        | { name?: string; status?: string; result?: { queryId?: string } }
        | undefined;
      if (
        !tool?.name?.startsWith("query_") ||
        tool.status !== "running" ||
        !tool.result?.queryId
      )
        throw new Error("This query is no longer active.");
      answerQuery(tool.result.queryId, value);
      return null;
    }
    case "app.view": {
      const { messageId } = z.object({ messageId: id }).parse(params);
      const message = store.get("message", messageId);
      const metadata = message.metadata.tool as
        | {
            name?: string;
            args?: { html?: unknown; libraries?: unknown; files?: unknown };
            result?: { app?: { html?: string } };
          }
        | undefined;
      const viewId = randomBytes(24).toString("hex");
      const allowed = chatAttachmentIds(message.chatId);
      const files: Record<string, string> = {};
      const fileIds = new Set<string>();
      for (const fileId of Array.isArray(metadata?.args?.files)
        ? metadata.args.files
        : []) {
        if (typeof fileId !== "string" || !allowed.has(fileId)) continue;
        const attachment = store.get("attachment", fileId);
        files[attachment.name] =
          `${ownOrigin}/views/files/${viewId}/${attachment.id}`;
        fileIds.add(attachment.id);
      }
      const html = metadata?.name?.startsWith("query_")
        ? queryDocument(
            metadata.name,
            metadata.args as Record<string, unknown>,
            ownOrigin,
            files,
          )
        : metadata?.name === "render_ui" &&
            typeof metadata.args?.html === "string"
          ? inlineUiDocument(
              metadata.args.html,
              Array.isArray(metadata.args.libraries)
                ? (metadata.args.libraries as string[])
                : [],
              ownOrigin,
              files,
            )
          : metadata?.result?.app?.html;
      if (!html) throw new Error("This tool has no embedded app.");
      for (const [key, view] of views)
        if (view.expires < Date.now()) views.delete(key);
      views.set(viewId, {
        html,
        expires: Date.now() + 60 * 60 * 1000,
        files: fileIds,
        mcp: metadata?.name === "call_mcp",
        googleFonts: metadata?.name === "query_font",
      });
      return { url: `${ownOrigin}/views/${viewId}` };
    }
    default:
      throw new Error("Unknown method.");
  }
}

function authorize(request: IncomingMessage, url: URL): void {
  const supplied =
    request.headers.authorization?.replace(/^Bearer /, "") ??
    (["/events", "/poll", "/media", "/attachment", "/browser-stream"].includes(url.pathname)
      ? url.searchParams.get("token")
      : null);
  const local =
    !!supplied &&
    supplied.length === token.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  if (!supplied || (!local && !remote.accepts(supplied)))
    throw new Error("Unauthorized.");
  if (!trustedOrigin(request.headers.origin))
    throw new Error("Untrusted origin.");
}

function trustedOrigin(origin: string | undefined): boolean {
  return (
    !origin ||
    origin === ownOrigin ||
    origin === process.env.BASEDCODE_UI_ORIGIN ||
    origin === "null" ||
    (!!remote.origin && origin === remote.origin)
  );
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

/** Serves the UI and API; the desktop backend and the remote-access server share it. */
async function handle(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/views/lib/")) {
      // Bundled widget libraries: an allowlist of package files, public and immutable (paths are versioned).
      const file =
        request.method === "GET" ? libraryFile(url.pathname) : undefined;
      if (!file) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": `${file.endsWith(".css") ? "text/css" : "text/javascript"}; charset=utf-8`,
        "Cache-Control": "public, max-age=31536000, immutable",
        // Widget frames are sandboxed (opaque origin); module scripts need CORS to load.
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      });
      await pipeline(createReadStream(file), response);
      return;
    }
    if (url.pathname.startsWith("/views/files/")) {
      // Chat attachments a widget asked for, scoped to that widget's secret view id.
      const [viewId, fileId] = url.pathname
        .slice("/views/files/".length)
        .split("/");
      const view = views.get(viewId ?? "");
      if (
        request.method !== "GET" ||
        !view ||
        view.expires < Date.now() ||
        !view.files?.has(fileId ?? "")
      ) {
        response.writeHead(404).end();
        return;
      }
      const attachment = store.get("attachment", fileId);
      response.writeHead(200, {
        "Content-Type": widgetFileType(attachment.name),
        "Content-Length": attachment.size,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      });
      await pipeline(
        createReadStream(join(attachmentDirectory, attachment.id)),
        response,
      );
      return;
    }
    if (url.pathname.startsWith("/views/")) {
      const view = views.get(url.pathname.slice("/views/".length));
      if (!view || view.expires < Date.now()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": view.mcp
          ? `sandbox allow-scripts allow-forms allow-pointer-lock allow-downloads; ${mcpWidgetCsp}`
          : `sandbox allow-scripts allow-forms allow-pointer-lock allow-downloads; default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: ${ownOrigin}/views/lib/ ${ownOrigin}/views/files/; style-src 'unsafe-inline'${view.googleFonts ? ` ${googleFontsCsp.style}` : ""}; img-src data: blob: ${ownOrigin}/views/files/; font-src data:${view.googleFonts ? ` ${googleFontsCsp.font}` : ""}; media-src data: blob: ${ownOrigin}/views/files/; worker-src blob:; connect-src ${ownOrigin}/views/files/; form-action 'none'; base-uri 'none'`,
      });
      response.end(view.html);
      return;
    }
    if (url.pathname === oauthCallbackPath && request.method === "GET") {
      // The browser returns here from an MCP server's authorization page; the one-time state authenticates it.
      const result = await mcp.oauth.callback(url.searchParams);
      const message = result.message.replace(
        /[&<>"']/g,
        (char) => `&#${char.charCodeAt(0)};`,
      );
      response.writeHead(result.ok ? 200 : 400, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'",
      });
      response.end(
        `<!doctype html><meta charset="utf-8"><title>BasedCode</title><body style="font:16px system-ui;padding:48px;text-align:center"><h1>BasedCode</h1><p>${message}</p></body>`,
      );
      events.publish("state");
      return;
    }
    if (
      ["/rpc", "/events", "/poll", "/media", "/attachment", "/browser-stream"].includes(
        url.pathname,
      )
    ) {
      if (request.method === "OPTIONS") {
        const origin = request.headers.origin;
        if (!origin || !trustedOrigin(origin)) {
          response.writeHead(403).end();
          return;
        }
        response.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "authorization,content-type",
          "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
        });
        response.end();
        return;
      }
      authorize(request, url);
      if (request.headers.origin)
        response.setHeader(
          "Access-Control-Allow-Origin",
          request.headers.origin,
        );
      if (url.pathname === "/attachment") {
        if (request.method !== "GET") {
          response.writeHead(405).end();
          return;
        }
        const attachment = store.get(
          "attachment",
          id.parse(url.searchParams.get("id")),
        );
        // Images and text render inline as inert content; anything else downloads rather than runs.
        const inline =
          /^image\/(png|jpeg|gif|webp)$/.test(attachment.mediaType) ||
          attachment.mediaType === "application/pdf";
        const text = !inline && isTextAttachment(attachment);
        response.writeHead(200, {
          "Content-Type": text
            ? "text/plain; charset=utf-8"
            : inline
              ? attachment.mediaType
              : "application/octet-stream",
          "Content-Length": attachment.size,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Disposition": `${inline || text ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
          "Content-Security-Policy":
            "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        });
        await pipeline(
          createReadStream(join(attachmentDirectory, attachment.id)),
          response,
        );
        return;
      }
      if (url.pathname === "/media") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405).end();
          return;
        }
        const { workspaceId, path } = z
          .object({ workspaceId: id, path: z.string() })
          .parse(Object.fromEntries(url.searchParams));
        const mediaType = previewMediaType(path);
        if (!mediaType) throw new Error("Unsupported media preview.");
        const file = await safePath(store.get("workspace", workspaceId), path);
        const metadata = await stat(file);
        if (!metadata.isFile()) throw new Error("Select a regular file.");
        const size = metadata.size;
        let start = 0;
        let end = size - 1;
        const range = request.headers.range;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (match && (match[1] || match[2])) {
            start = match[1]
              ? Number(match[1])
              : Math.max(0, size - Number(match[2]));
            end =
              match[1] && match[2]
                ? Math.min(size - 1, Number(match[2]))
                : size - 1;
          }
          if (
            !match ||
            (!match[1] && !match[2]) ||
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            start >= size
          ) {
            response
              .writeHead(416, { "Content-Range": `bytes */${size}` })
              .end();
            return;
          }
          response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        }
        response.writeHead(range ? 206 : 200, {
          "Content-Type": mediaType,
          "Content-Length": Math.max(0, end - start + 1),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        });
        if (request.method === "HEAD" || size === 0) {
          response.end();
          return;
        }
        await pipeline(createReadStream(file, { start, end }), response);
        return;
      }
      if (url.pathname === "/poll" && request.method === "GET") {
        // Answers at once with events after `after`, or waits up to 25 s for the next one. A cursor from
        // before the buffer (or a restarted backend) gets `reset`, so the client reloads state.
        const after = Number(url.searchParams.get("after") ?? "-1");
        const reply = () => {
          const reset =
            after < 0 ||
            after > eventSeq ||
            (recentEvents.length > 0 && after < recentEvents[0].seq - 1);
          json(response, 200, {
            seq: eventSeq,
            reset,
            events: reset
              ? []
              : recentEvents
                  .filter((item) => item.seq > after)
                  .map((item) => item.event),
          });
        };
        if (after < 0 || after !== eventSeq) {
          reply();
          return;
        }
        const done = () => {
          clearTimeout(timeout);
          events.off("event", wake);
        };
        // Let a burst (streamed tokens) gather briefly instead of one request per token.
        const wake = () => {
          done();
          setTimeout(reply, 50);
        };
        const timeout = setTimeout(() => {
          done();
          reply();
        }, 25_000);
        events.on("event", wake);
        request.on("close", done);
        return;
      }
      if (url.pathname === "/browser-stream" && request.method === "GET") {
        // The agent browser as an MJPEG stream: the window's <img> decodes and paints each part as it lands.
        const chatId = z.string().min(1).parse(url.searchParams.get("chatId"));
        response.writeHead(200, {
          "Content-Type": "multipart/x-mixed-replace; boundary=frame",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
          Connection: "keep-alive",
        });
        response.write("--frame\r\n");
        let sent: Buffer | undefined;
        // A slow viewer skips frames rather than queueing them; after a drain it catches up to the newest one.
        const send = (image: Buffer) => {
          if (response.writableNeedDrain || image === sent) return;
          sent = image;
          // The next boundary goes out with the frame, so the browser paints it now instead of on the next frame.
          response.write(`Content-Type: image/jpeg\r\nContent-Length: ${image.length}\r\n\r\n`);
          response.write(image);
          response.write("\r\n--frame\r\n");
        };
        const onFrame = (id: string, image: Buffer) => {
          if (id === chatId) send(image);
        };
        const onDrain = () => {
          const image = browserFrames.get(chatId);
          if (image) send(image);
        };
        const onEnd = (id: string) => {
          if (id === chatId) response.end();
        };
        events.on("frame", onFrame);
        events.on("frame-end", onEnd);
        response.on("drain", onDrain);
        onDrain();
        response.on("close", () => {
          events.off("frame", onFrame);
          events.off("frame-end", onEnd);
        });
        return;
      }
      if (url.pathname === "/events" && request.method === "GET") {
        // no-transform and X-Accel-Buffering stop proxies such as the Cloudflare tunnel from compressing and holding back events.
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
          Connection: "keep-alive",
        });
        response.flushHeaders();
        const send = (event: unknown) =>
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        events.on("event", send);
        response.write(": connected\n\n");
        const heartbeat = setInterval(
          () => response.write(": heartbeat\n\n"),
          20_000,
        );
        request.on("close", () => {
          clearInterval(heartbeat);
          events.off("event", send);
        });
        return;
      }
      if (url.pathname !== "/rpc" || request.method !== "POST") {
        json(response, 405, { error: "Method not allowed." });
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        // Attachment uploads arrive as base64 (4/3 of 20 MiB); everything else stays far smaller.
        if (length > 28_000_000) throw new Error("Request exceeds 28 MB.");
        chunks.push(chunk);
      }
      const input = z
        .object({ method: z.string(), params: z.unknown().optional() })
        .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      json(response, 200, {
        result: await rpc(input.method, input.params ?? {}),
      });
      return;
    }
    const uiRoot = resolve("dist/ui");
    const path = resolve(
      uiRoot,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!isInside(uiRoot, path)) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await readFile(path);
    response.writeHead(200, {
      "Content-Type":
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(path)] ?? "application/octet-stream",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        url.pathname === "/mcp-ui.html"
          ? mcpWidgetCsp
          : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'",
    });
    response.end(bytes);
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    json(
      response,
      detail === "Unauthorized." || detail === "Untrusted origin." ? 403 : 400,
      {
        error: detail,
      },
    );
  }
}

const remote = new RemoteAccess(handle, () => events.publish("remote"));
const server = createServer((request, response) => {
  void handle(request, response);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot determine local backend address.");
  ownOrigin = `http://127.0.0.1:${address.port}`;
  process.send?.({ type: "ready", origin: ownOrigin });
});

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  agent.suspendScheduling();
  await agent.shutdown();
  remote.stop();
  processes.shutdown();
  languages.close();
  await mcp.close();
  server.close();
  store.db.close();
  process.exit(0);
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("message", (message) => {
  if (message === "shutdown") void shutdown();
});
