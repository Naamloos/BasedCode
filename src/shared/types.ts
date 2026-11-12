import type { GuidedMode } from "./chatModes.js";
export type ProviderKind =
  "codex" | "claude" | "antigravity" | "ollama" | "lmstudio" | "openai";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /** User-chosen label, to tell apart several connections of the same kind. Empty means the kind's name. */
  name?: string;
  model: string;
  endpoint: string;
  enabled: boolean;
  requireConsent: boolean;
  /** Reasoning effort for models that support it; empty means the model default and 'off' turns reasoning off. */
  effort?: string;
}

/** Effort value that turns reasoning off (Claude thinking disabled; local models asked not to think). */
export const reasoningOff = "off";

/**
 * How gated operations (commands, deletes, installs, MCP calls, task start) are decided.
 * always: ask every time. per-tool: ask the first time each tool is used in a chat.
 * no-commands: edits only; commands, installs and external calls are refused without asking.
 * allow-all: approve everything without asking (still recorded).
 */
export type ApprovalMode = "always" | "per-tool" | "no-commands" | "allow-all";

export type AppLanguage = "en" | "nl" | "based";

export type ThemeMode = "dark" | "light" | "system";

export const themeTokenNames = ["--bg","--surface","--surface-raised","--surface-hover","--surface-active","--border","--border-strong","--text","--text-secondary","--muted","--faint","--accent","--accent-hover","--accent-soft","--accent-line","--on-accent","--success","--warning","--danger"] as const;
export type ThemeTokens = Record<(typeof themeTokenNames)[number], string>;

export interface CustomTheme {
  id: string;
  name: string;
  scheme: 'dark' | 'light';
  tokens: ThemeTokens;
}

export interface Appearance {
  customThemes?: CustomTheme[];
  /** Theme in the dark slot. Any theme may sit in either slot. */
  theme: string;
  /** Theme in the light slot. */
  lightTheme: string;
  /** Which slot is active; system follows prefers-color-scheme. */
  mode: ThemeMode;
  flame: string;
}

/** App-wide settings that apply to every workspace. */
export interface GlobalSettings {
  welcomeDismissed: boolean;
  /** Model connections and their default fallback order. Workspaces may reorder or disable them. */
  providers: ProviderConfig[];
  mcpServers: ServerConfig[];
  /** Registries the MCP marketplace browses. Absent: `defaultMcpRegistries`. */
  mcpRegistries?: McpRegistry[];
  /**
   * Ids from `defaultMcpRegistries` this install has already been offered. A default that appears in a later
   * release is added once; one the user removed stays removed.
   */
  knownMcpRegistries?: string[];
  languageServers: LanguageConfig[];
  approvalMode: ApprovalMode;
  language?: AppLanguage;
  /** BasedCode tool names hidden from the model. Absent/empty: every tool is enabled. */
  disabledTools?: string[];
  /** Summarize older conversation when the estimated prompt passes this many tokens. */
  compaction: { enabled: boolean; thresholdTokens: number };
  appearance: Appearance;
  /** Shortcut overrides by action ID, e.g. { "terminal.toggle": "Ctrl+J" }; '' unbinds. Missing actions use defaults. */
  keybindings: Record<string, string>;
  /** Executable overrides; empty means find `codex` / `claude` / `agy` on PATH. */
  codexPath: string;
  claudePath: string;
  antigravityPath?: string;
  /** cloudflared executable for remote access; empty or absent means `cloudflared` on PATH. */
  cloudflaredPath?: string;
  /** Template for newly opened workspaces; absent means the built-in defaults. */
  newWorkspace?: WorkspaceSettings;
  /** Command rules for every workspace, applied together with each workspace's own rules. */
  commandRules?: CommandRules;
  /** Run budget for workspaces without their own. Absent: `defaultRunBudget`. */
  budget?: RunBudget;
  /** Default for workspaces that don't set `fixFailedChecks`. Absent: on. */
  fixFailedChecks?: boolean;
  /** Push notifications for approvals and finished prompts, sent to a URL the user chose (ntfy topic or JSON webhook). */
  notifications?: NotificationSettings;
  /** Ask before tool calls that would send a likely secret off this machine. Absent: on. */
  secretGuard?: boolean;
  /**
   * Keep rarely used tool groups out of every model request; the model loads their arguments on demand
   * (load_tools/call_tool). Absent: on.
   */
  deferTools?: boolean;
  /** About the user: personalizes the system prompt; the avatar is only shown in chat. */
  profile?: UserProfile;
}

export interface UserProfile {
  name?: string;
  occupation?: string;
  /** How much the user knows; the agent pitches explanations to it. */
  experience?: "" | "beginner" | "intermediate" | "expert";
  /** "plain" swaps the shitposting voice for a neutral, professional one. */
  voice?: "based" | "plain";
  /** Free-form notes for the agent: preferences, stack, conventions. */
  about?: string;
  /** Cropped square image as a data URL (image/jpeg base64). */
  avatar?: string;
}

export interface NotificationSettings {
  enabled: boolean;
  /** ntfy topic URL (https://ntfy.sh/my-topic) or any JSON webhook. */
  url: string;
  format: "ntfy" | "json" | "discord" | "slack" | "telegram" | "gotify";
  approvals: boolean;
  finished: boolean;
}

/** A workspace's own fallback order: global provider IDs in order, each enabled or not. */
export interface FallbackEntry {
  providerId: string;
  enabled: boolean;
}

export interface ServerConfig {
  id: string;
  name: string;
  /** stdio: local process. http: Streamable HTTP. sse: legacy HTTP+SSE remote. */
  transport: "stdio" | "http" | "sse";
  url?: string;
  command?: string;
  args?: string[];
  /** Absent means enabled. Disabled servers stay configured but are hidden from agents. */
  enabled?: boolean;
  description?: string;
  /** Non-secret environment variables for stdio servers. */
  env?: Record<string, string>;
  /** Non-secret HTTP headers for remote servers. */
  headers?: Record<string, string>;
  /** Names of environment variables / headers whose values live in the OS credential store, never in settings. */
  secretEnv?: string[];
  secretHeaders?: string[];
  /** Remote sign-in: 'oauth' runs the MCP authorization flow (PKCE, dynamic client registration when no client ID). */
  auth?: "none" | "oauth";
  oauth?: { clientId?: string; scopes?: string };
  /** Where a marketplace install came from. */
  registry?: { registryId: string; name: string; version: string };
}

/** An MCP registry speaking the official registry API (GET {url}/servers). */
export interface McpRegistry {
  id: string;
  name: string;
  /** Base URL including the API version, e.g. https://registry.modelcontextprotocol.io/v0.1 */
  url: string;
  enabled: boolean;
  /**
   * The API it speaks. Absent or 'official': the MCP Registry API (v0.1), which mcp.tc and GitHub also serve.
   * 'mcpcentral' and 'truespar' are those catalogs' own APIs, converted to registry entries by the backend.
   */
  format?: McpRegistryFormat;
}

export const mcpRegistryFormats = [
  "official",
  "mcpcentral",
  "truespar",
] as const;
export type McpRegistryFormat = (typeof mcpRegistryFormats)[number];

export const defaultMcpRegistries: McpRegistry[] = [
  {
    id: "official",
    name: "MCP Registry",
    url: "https://registry.modelcontextprotocol.io/v0.1",
    enabled: true,
  },
  {
    id: "github",
    name: "GitHub MCP Registry",
    url: "https://api.mcp.github.com/v0.1",
    enabled: true,
  },
  { id: "mcptc", name: "mcp.tc", url: "https://mcp.tc/v0.1", enabled: true },
  {
    id: "mcpcentral",
    name: "MCP Central",
    url: "https://mcpcentral.io/api",
    enabled: true,
    format: "mcpcentral",
  },
  {
    id: "truespar",
    name: "Truespar",
    url: "https://registry.truespar.com/v1",
    enabled: true,
    format: "truespar",
  },
];

/** A value the user fills in when installing from a registry, generated from the registry metadata. */
export interface McpInstallField {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  secret: boolean;
  default?: string;
  choices?: string[];
}

/** One way to run a registry server: a package (stdio) or a remote endpoint. */
export interface McpInstallOption {
  id: string;
  kind: "package" | "remote";
  transport: ServerConfig["transport"];
  /** npm, pypi, oci, nuget, mcpb… or the remote URL. */
  label: string;
  /** Runtime the user needs, e.g. "Node.js (npx)", "Docker". */
  requirement?: string;
  fields: McpInstallField[];
}

export interface McpRegistryServer {
  name: string;
  title?: string;
  description: string;
  version: string;
  repository?: string;
  website?: string;
  icon?: string;
  options: McpInstallOption[];
}

/** Credential and sign-in state of a configured server; values themselves never leave the backend. */
export interface McpServerStatus {
  savedSecrets: string[];
  signedIn: boolean;
}

export interface LanguageConfig {
  id: string;
  name: string;
  languages: string[];
  command: string;
  args: string[];
}

export const languageOperations = [
  "diagnostics",
  "definition",
  "references",
  "hover",
  "symbols",
  "completion",
  "signatureHelp",
  "typeDefinition",
  "implementation",
  "documentHighlight",
] as const;
export type LanguageOperation = (typeof languageOperations)[number];

export interface LanguageServerStatus extends LanguageConfig {
  available: boolean;
  canInstall: boolean;
}

export interface CommandRules {
  allow: string[];
  deny: string[];
}

/** Per-run limits. Reaching one pauses the run on an approval card; absent fields are unlimited. */
export interface RunBudget {
  maxToolCalls?: number;
  maxTokens?: number;
  maxCostUsd?: number;
}

/** Applied when a workspace sets no budget of its own. */
export const defaultRunBudget: RunBudget = { maxToolCalls: 150 };

export interface WorkspaceSettings {
  /** Absent: follow the global provider order. Present: this workspace's own order. */
  fallback?: FallbackEntry[];
  /** MCP servers available only in this workspace. */
  mcpServers?: ServerConfig[];
  /** Absent: use the global approval mode. */
  approvalMode?: ApprovalMode;
  /** Terminal command patterns (`*` matches anything). Deny wins over allow; allow skips the approval prompt. */
  commandRules?: CommandRules;
  /** Absent: the app's budget. */
  budget?: RunBudget;
  /** When final checks fail, give the failures back to the model for one fix-up round. Absent: the app's choice. */
  fixFailedChecks?: boolean;
  /** Extra instructions for every prompt in this workspace, like a project CLAUDE.md kept in app settings. */
  instructions?: string;
  /** Mode for new chats in this workspace. Absent: 'default'. */
  defaultMode?: ChatMode;
  checks: { name: string; command: string }[];
  editor: { command: string; args: string[] };
}

export interface Workspace {
  id: string;
  path: string;
  name: string;
  lastOpenedAt?: string;
  settings: WorkspaceSettings;
  /** A private folder in app data backing one non-workspace chat; hidden from workspace lists. */
  scratch?: boolean;
  /** Set when the user removed the workspace from BasedCode (its folder is untouched); opening the folder again restores it. */
  removedAt?: string;
}

/** default: normal coding agent. Guided modes (duck, pair, archaeology, ...) are listed in shared/chatModes.ts. review: read-only second opinion on another chat's prompt. */
export type ChatMode = "default" | GuidedMode | "review";

export interface Chat {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  stale: boolean;
  deletedAt?: string;
  /** Absent means 'default'. */
  mode?: ChatMode;
  /** Pinned chats sit at the top of the sidebar. */
  pinned?: boolean;
  /** The chat this one was forked from, if any. */
  forkedFrom?: string;
  /** The chat this one was handed off from, in another mode, if any. */
  handedOffFrom?: string;
  /** Archived chats leave the workspace groups for an Archived group; sending a prompt unarchives them. */
  archivedAt?: string;
  /** Set when a guided-mode session was wrapped up. The chat takes no new prompts after this. */
  wrappedUpAt?: string;
  /** Who set the title. Absent: taken from the first prompt. 'agent': set_chat_title. 'user': renamed by hand, so the agent leaves it. */
  titleSource?: "agent" | "user";
  /** Provider this chat is pinned to; it goes first, ahead of the workspace fallback order. */
  providerId?: string;
  /** Model and effort for `providerId`, overriding the connection's own. */
  model?: string;
  effort?: string;
  /** Review sub-chats: the chat and prompt they give a second opinion on. Hidden from the sidebar. */
  reviewOf?: { chatId: string; runId: string };
  /** Re-run chats: the prompt this chat repeats with another model, for comparison. */
  rerunOf?: string;
}

/** One A/B comparison: a prompt and its re-run with another model, and which result the user kept. */
export interface Comparison {
  id: string;
  workspaceId: string;
  originalRunId: string;
  rerunRunId: string;
  /** The run whose files the workspace holds now. */
  current: string;
  /** Set when the user picked a winner. */
  kept?: string;
  createdAt: string;
}

/** A model as reported by its provider, for the model picker. Missing fields mean the provider did not say. */
export interface ModelInfo {
  id: string;
  parameters?: string;
  quantization?: string;
  sizeBytes?: number;
  contextLength?: number;
  loaded?: boolean;
  tools?: boolean;
  thinking?: boolean;
  vision?: boolean;
  description?: string;
  /** Human-readable name when it differs from the ID. */
  name?: string;
  /** Reasoning effort levels the model accepts, lowest first. */
  efforts?: string[];
  defaultEffort?: string;
  /** The provider's default model. */
  isDefault?: boolean;
  /** Not in the account's own picker list (hidden or a known older ID); it may be unavailable. */
  unlisted?: boolean;
}

export interface ProviderCatalog {
  providerId: string;
  models: ModelInfo[];
  error?: string;
}

/** Generation measurements for one prompt, accumulated over every model call it made. */
export interface RunStats {
  provider: string;
  model: string;
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Time to first token of the first model call. */
  ttftMs?: number;
  /** Prompt processing time: request start to first token, summed over calls. */
  promptMs: number;
  /** Decoding time: first to last token, summed over calls. Output tok/s = outputTokens / generationMs. */
  generationMs: number;
  /** Wall time from the first model call to the end of the run. */
  totalMs: number;
  /** True when the provider did not report token counts and they were estimated from streamed chunks. */
  estimated: boolean;
  /** Cost the provider reported (Claude Code), or an estimate from list prices for OpenAI models; absent when neither is known. */
  costUsd?: number;
  /** True when `costUsd` is estimated from LiteLLM's price list rather than reported by the provider. */
  costEstimated?: boolean;
}

/** One subscription usage window, such as the 5-hour or weekly limit. */
export interface LimitWindow {
  label: string;
  /** Percentage of the window used, when the provider reports it. */
  usedPercent?: number;
  resetsAt?: string;
  status?: "allowed" | "allowed_warning" | "rejected";
}

/** Latest known usage windows for a subscription provider, and when and how they were learned. */
export interface ProviderLimits {
  id: string;
  kind: ProviderKind;
  windows: LimitWindow[];
  plan?: string;
  updatedAt: string;
  source: string;
}

/** A file attached to a prompt. Contents live in app storage, outside the workspace. */
export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: string;
}

/** Usage totals for one slice (a provider/model, a day, a workspace or a chat). */
export interface UsageTotals {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Sum of provider-reported costs; runs without a reported cost are counted in `unpricedRuns`. */
  costUsd: number;
  unpricedRuns: number;
  totalMs: number;
}

export interface UsageReport {
  total: UsageTotals;
  byModel: (UsageTotals & { provider: string; model: string })[];
  /** Chart buckets; `day` is YYYY-MM-DD, or YYYY-MM when `bucket` is 'month'. */
  byDay: (UsageTotals & { day: string })[];
  bucket: "day" | "month";
  byWorkspace: (UsageTotals & { workspaceId: string; name: string })[];
}

export type RunStatus =
  | "queued"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface Run {
  id: string;
  chatId: string;
  workspaceId: string;
  prompt: string;
  status: RunStatus;
  provider?: string;
  /** Position of the active provider in the workspace's enabled fallback list; above 0 means fallback is in use. */
  providerIndex?: number;
  stats?: RunStats;
  /** Project instruction files (AGENTS.md / CLAUDE.md) applied to this run, as shown to the model. */
  instructionFiles?: string[];
  error?: string;
  createdAt: string;
  /** Set while waiting to retry after a dropped connection or rate limit. */
  reconnecting?: { attempt: number; max: number; until: string };
  /** Set on turns copied into a forked chat: the original run. Copies have no checkpoint, so they cannot be reverted. */
  forkedFrom?: string;
}

export interface Message {
  id: string;
  chatId: string;
  runId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Approval {
  id: string;
  runId?: string;
  workspaceId: string;
  title: string;
  detail: string;
  status: "pending" | "approved" | "denied";
  /** Decided by the approval mode rather than by a person; names the mode. */
  auto?: ApprovalMode;
  /** The terminal command being approved, so the card can offer "always allow this command". */
  command?: string;
  /** The command rule that decided this approval automatically. */
  rule?: string;
}

export interface Action {
  id: string;
  workspaceId: string;
  chatId?: string;
  runId?: string;
  title: string;
  detail: string;
  status: "pending" | "completed" | "failed" | "unknown";
  reverted: boolean;
  createdAt: string;
}

export interface TerminalInfo {
  id: string;
  workspaceId: string;
  runId?: string;
  title: string;
  /** user: interactive shell; command: agent command awaited by its tool call; service: agent process left running (dev server, watcher). */
  kind: "user" | "command" | "service";
  cwd: string;
  owner: "agent" | "user";
  status: "running" | "exited";
  exitCode?: number;
  /** Set when the user stopped or closed the process from the UI. */
  stoppedByUser?: boolean;
  output: string;
}

export interface Change {
  path: string;
  kind: "created" | "modified" | "deleted";
  diff: string;
  binary: boolean;
}

export interface Diagnostic {
  uri: string;
  server: string;
  message: string;
  severity?: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface AppEvent {
  type: string;
  workspaceId?: string;
  runId?: string;
  data: unknown;
}

export interface AppState {
  /** Whether git was found at startup; prompt checkpoints (and so revert) need it. */
  git?: { available: boolean; version?: string };
  workspaces: Workspace[];
  chats: Chat[];
  runs: Run[];
  messages: Message[];
  approvals: Approval[];
  actions: Action[];
  terminals: TerminalInfo[];
  diagnostics: Diagnostic[];
  sandbox: { available: boolean; detail: string };
  global: GlobalSettings;
  /** Provider IDs with a saved credential, and whether saving to the OS credential store is possible. */
  credentials: {
    saved: string[];
    storage: { available: boolean; detail: string };
  };
  limits: ProviderLimits[];
  comparisons: Comparison[];
}

export const kindNames: Record<ProviderKind, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openai: "OpenAI-compatible",
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
};

/** The connection's display name: its own name if set, else its kind's. */
export const providerName = (provider: ProviderConfig) =>
  provider.name?.trim() || kindNames[provider.kind];

/** Steering is a mid-run message; only providers that accept input while working can take one. */
export const steerableKinds: ProviderKind[] = [
  "ollama",
  "lmstudio",
  "openai",
  "claude",
  "antigravity",
];

/** The workspace's effective provider order: its own fallback list over the global connections, or the global order. */
/** App-wide and workspace command rules together; a deny in either list wins. */
export function effectiveCommandRules(
  global: GlobalSettings,
  workspace: Workspace,
): CommandRules {
  return {
    allow: [
      ...(global.commandRules?.allow ?? []),
      ...(workspace.settings.commandRules?.allow ?? []),
    ],
    deny: [
      ...(global.commandRules?.deny ?? []),
      ...(workspace.settings.commandRules?.deny ?? []),
    ],
  };
}

export function effectiveBudget(
  global: GlobalSettings,
  workspace: Workspace,
): RunBudget {
  return workspace.settings.budget ?? global.budget ?? defaultRunBudget;
}

export function effectiveFixFailedChecks(
  global: GlobalSettings,
  workspace: Workspace,
): boolean {
  return workspace.settings.fixFailedChecks ?? global.fixFailedChecks ?? true;
}

export function effectiveProviders(
  global: GlobalSettings,
  workspace?: Workspace,
): ProviderConfig[] {
  const fallback = workspace?.settings.fallback;
  if (!fallback) return global.providers;
  const ordered = fallback.flatMap((entry) => {
    const provider = global.providers.find(
      (item) => item.id === entry.providerId,
    );
    return provider ? [{ ...provider, enabled: entry.enabled }] : [];
  });
  // Connections added globally after the workspace saved its order keep their global state at the end.
  return [
    ...ordered,
    ...global.providers.filter(
      (provider) => !fallback.some((entry) => entry.providerId === provider.id),
    ),
  ];
}

/** Remote access through a Cloudflare quick tunnel. `url` carries the access code in its hash. */
export interface RemoteAccessStatus {
  state: "stopped" | "starting" | "running" | "error";
  url?: string;
  port?: number;
  /** QR code for `url`, as an SVG data URL. */
  qr?: string;
  error?: string;
}

/** Tools that can change workspace files. A snapshot before each lets the user rewind a run to that call. */
export const fileChangingTools: ReadonlySet<string> = new Set([
  "write_file",
  "apply_patch",
  "edit_lines",
  "move_file",
  "delete_file",
  "make_directory",
  "delete_directory",
  "run_command",
  "terminal_input",
  "run_checks",
  "git",
  "git_branch",
  "git_stash",
  "git_stage",
  "git_commit",
  "install",
  "language_rename",
  "language_code_actions",
  "create_skill",
]);
