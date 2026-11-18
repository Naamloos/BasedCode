# Agent tool parity

Audit date: 2026-11-17. BasedCode source: `master` at `338a839`.

This compares BasedCode's registered agent tools with five other coding agents. It merges the earlier Codex and Claude Code audits and adds T3 Code, OpenCode and pi, checked against their source code.

## Sources

Every finding names the agent it came from with a tag. The tags differ in how much evidence is behind them:

| Tag | Agent | How it was checked |
| --- | --- | --- |
| **[Codex]** | OpenAI Codex desktop app | Tool contracts exposed to a live Codex session (audit 2026-11-12, previously `CODEX-PARITY.md`). |
| **[Claude]** | Claude Code, desktop app (Code tab) | Tool contracts exposed to a live Claude Code session (audit 2026-11-17, previously `CLAUDE-PARITY.md`). |
| **[OpenCode]** | OpenCode ([sst/opencode](https://github.com/sst/opencode)) | Source at `db1d7b9` (2026-11-17), mainly `packages/core/src/tool/plugin/`, plus the public docs. |
| **[pi]** | pi coding agent ([badlogic/pi-mono](https://github.com/badlogic/pi-mono)) | Source at `4afe78d` (2026-11-17), mainly `packages/coding-agent/src/core/tools/`, `src/extensions/` and `docs/`. |
| **[T3]** | T3 Code ([pingdotgg/t3code](https://github.com/pingdotgg/t3code)) | Source at `13458006` (2026-11-17), mainly `apps/server/src/mcp/toolkits/`, `checkpointing/` and `packages/`. |

[Codex] and [Claude] come from tools actually present in a session. [OpenCode], [pi] and [T3] come from reading their source, which shows what is registered but not how it behaves at runtime. Nothing from the three repos was built or run.

"Missing" means missing from BasedCode's registered agent tools, unless the text calls it an app-level gap. A shell workaround or a configurable MCP integration does not count as built-in support, and a different tool name is not a missing capability.

### What each agent is

- **Codex, Claude Code, OpenCode** are full agents with their own tool sets, comparable to BasedCode's.
- **pi** is a minimal agent. Its core tools are `read`, `write`, `edit`, `bash` and `powershell`; `grep`, `find` and `ls` are optional. The source has moved past the author's 2025 design post: built-in extensions now add MCP, `codemode` and `tool_search` (`src/extensions/index.ts`). It still has no subagents, plan mode, to-dos or approval prompts. Its [security doc](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/security.md) says it "does not ask for approval before every tool call" and recommends a container as the safety boundary.
- **T3 Code** is a control plane that drives agents the user already has: Claude Code, Codex, Cursor, OpenCode, Pi, Grok, Kiro, Muse, fx and any ACP agent (`packages/provider-*`). It is closer to BasedCode than its README suggests. It injects its **own MCP tools** into every agent it runs (`apps/server/src/mcp/OrchestratorMcpService.ts`) and keeps its own git-based checkpoints. That makes it the most direct comparison for BasedCode's "app-owned tools on top of any provider" design.

## Capability matrix

✅ built in · ◐ partial · ❌ absent · 🚫 deliberately omitted · "agent" = depends on the agent T3 runs

Rows are in order of value for BasedCode to add, following [Priority](#priority). Gaps come first, then partial support, then what BasedCode already has. **#** is the priority rank. Rows marked **1.4.0** were added in that release.

| # | Capability | BasedCode | Codex | Claude | OpenCode | pi | T3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | **Subagents / delegation** | ◐ (reviews) | ✅ | ✅ | ✅ (`subagent`) | 🚫 | ✅ (`delegate_task`, cross-agent) |
| **2** | **Web search** | ❌ | ✅ | ✅ | ✅ (Exa, Firecrawl, Parallel, Tavily, TinyFish) | ❌ | agent |
| **4** | **Scheduled / repeating work** | ❌ | ✅ | ✅ | ✅ (`automation_*`) | ❌ | ✅ (`schedule_task`) |
| **5** | **Plan mode** | ◐ (Planner mode: prompt only, edits not blocked) | ❌ | ✅ | ✅ (`plan` agent) | 🚫 | agent |
| **7** | **Hooks / plugins / extensions** | ❌ | ◐ (plugins) | ✅ | ✅ (plugins) | ✅ (extension events) | ❌ |
| **8** | **Session tools for the agent** | ◐ (rename only) | ✅ | ✅ | ◐ (rename, move) | ❌ | ✅ (create, pin, snooze, archive, message) |
| **8** | **PR / issue tooling** | ❌ | ◐ (GitHub connector) | ✅ | ❌ | ❌ | ✅ (PRs on 7 hosts, issues) |
| **8** | **Remote / mobile clients** | ◐ (Cloudflare tunnel, no mobile app) | ❌ | ✅ | ◐ (web pairing) | ✅ (RPC/SDK, no client) | ✅ (web, iOS, Android, SSH, Tailscale) |
| **8** | **Secret requests** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`request_secret`, 1Password) |
| **9** | **Full MCP discovery and events** | ✅ (cursor pagination, templates, event watch) | ✅ | ✅ | ✅ (+ resources, event watch) | ✅ (built-in extension) | ✅ |
| 1.4.0 | Managed worktrees | ✅ (`worktree_*`, sidebar menu) | ✅ | ✅ | ✅ (`worktree_*`) | ❌ | ✅ (per thread, merge back) |
| 1.4.0 | Model-written tool orchestration | ✅ (`run_script`, QuickJS sandbox) | ✅ (`exec`) | ❌ | ✅ (`execute`) | ✅ (`codemode`) | ❌ |
| 1.4.0 | Persistent memory | ✅ (`memory_*`, Settings → Memory) | ❌ | ✅ | ❌ | ❌ | ❌ |
| 1.4.0 | Artifacts / persistent compute | ✅ (`artifact_*`, versioned; `run_script` store/load) | ✅ | ◐ (Artifacts) | ✅ (`artifact_*`) | ❌ | ❌ |
| **9** | **Image generation** | ❌ | ✅ | ❌ | ✅ (experimental) | ❌ | ❌ |
| **9** | **User's real browser / tabs** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **9** | **Mobile devices / simulators** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (`device_*`) |
| **9** | **Persistent goals** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| — | Read / search / edit files | ✅ | ✅ | ✅ | ✅ | ✅ | agent |
| — | Shell commands | ✅ | ✅ | ✅ | ✅ | ✅ (bash + PowerShell) | agent |
| — | Background processes / terminal I/O | ✅ | ✅ | ✅ | ✅ | 🚫 (use tmux) | ✅ (app terminals) |
| — | Per-action approvals | ✅ | ✅ | ✅ | ✅ (allow/ask/deny rules) | 🚫 (only via extension hooks) | ✅ (+ capability checks on its tools) |
| — | Checkpoints / restore | ✅ (every write) | ❌ | ◐ (rewind) | ✅ (git snapshots) | ❌ | ✅ (git checkpoints, per turn) |
| — | Language-server tools | ✅ | ❌ | ❌ | ❌ (LSP diagnostics still a TODO) | ❌ | ❌ |
| — | Structured questions | ✅ (rich pickers) | ✅ (+ nonblocking) | ✅ | ✅ (`question`) | ❌ | ✅ (`user_input`) |
| — | Inline visuals / widgets | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (`html_preview`) |
| — | Task checklist | ✅ | ✅ | ✅ | ✅ (`todowrite`) | 🚫 | agent |
| — | Deferred tool loading | ✅ | ✅ | ✅ | ✅ | ✅ (`tool_search`) | ✅ (`tool_search`) |
| — | Skills | ✅ | ✅ | ✅ | ✅ | ✅ | agent |
| — | Isolated browser | ✅ | ✅ | ✅ | ✅ (desktop app) | ❌ | ✅ (`preview_*`, with recording) |
| — | Desktop computer use | ✅ (experimental) | ❌ (disabled) | ✅ | ❌ | ❌ | ❌ |
| — | Web fetch | ✅ | ✅ | ✅ | ✅ | ❌ (via bash) | agent |
| — | Session branching | ✅ (fork) | ✅ | ✅ | ✅ | ✅ (session tree) | ✅ |
| — | Multiple backends in one app | ✅ | ❌ | ❌ | ✅ (models) | ✅ (models) | ✅ (agents) |

Rows in **bold** are BasedCode gaps. Rows that share a rank come from the same group in [Priority](#priority).

## Already covered

| Capability | BasedCode equivalent | Seen in |
| --- | --- | --- |
| Read, search, edit files | `read_file`, `read_files`, `search`, `find_files`, `file_outline`, `write_file`, `apply_patch`, `edit_lines`, `move_file`, `file_info`, `make_directory`, `delete_directory` | [Codex] [Claude] [OpenCode] [pi] |
| Commands and running processes | `run_command`, `terminal_output`, `terminal_input`, `stop_terminal`; `run_checks` for structured results | [Codex] [Claude] [OpenCode] [pi] (foreground only) |
| Images and documents | `view_image`; `extract_document` (PDF, Office, OpenDocument, EPUB) | [Codex] [Claude] [pi] (images) |
| Notebooks | ◐ file tools edit `.ipynb` JSON; no cell-aware tool like [Claude] `NotebookEdit` | [Claude] |
| Isolated browser | `browser_navigate`, `browser_inspect`, `browser_click`, `browser_fill`, `browser_interact`, `browser_wait`, `browser_screenshot`, `browser_logs`, `browser_control` | [Codex] [Claude] [OpenCode] [T3] |
| Desktop control | `computer_screenshot`, `computer_click`, `computer_move`, `computer_drag`, `computer_scroll`, `computer_type`, `computer_key` | [Claude] |
| Structured questions | Text, yes/no, choice, `query_color`, `query_font`, `query_radius`, `query_slider`, `query_preview`, `query_ui` | [Codex] [Claude] [OpenCode] [T3] |
| Inline visuals | `render_ui`, `render_chart`, `render_diagram`, `show_image`, widget libraries | [Codex] [Claude] [T3] `html_preview` |
| Checklist | `update_plan` | [Codex] [Claude] [OpenCode] `todowrite` |
| Deferred tools | `load_tools`, `call_tool` | [Codex] [Claude] `ToolSearch`, [OpenCode], [pi] and [T3] `tool_search` |
| MCP | `list_mcp`, `call_mcp`, `read_mcp_resource`, `get_mcp_prompt`, `install_server`, OAuth, MCP app views | [Codex] [Claude] [OpenCode] [pi] [T3] |
| Skills | `list_skills`, `activate_skill`, `create_skill` | [Codex] [Claude] [OpenCode] [pi] |
| Web fetch | `web_fetch` | [Codex] [Claude] [OpenCode] |
| Checkpoints | Per-write checkpoints and restore | [OpenCode] `Snapshot` (git, capture/diff/restore), [T3] `CheckpointStore` (git, restore per turn) |
| Chat title, reviews, deadlines | `set_chat_title`, `second_opinions`, `prompt_time_limit` | [Codex] [Claude] [OpenCode] `session_rename`, [T3] `rename` |
| Git | Git read tools, `git_branch`, `git_stash`, `git_stage`, `git_commit` | [Codex] [Claude] [T3] |

Evidence: [tool registration](src/server/tools/tools.ts), [deferred groups](src/server/tools/deferred.ts), [tool implementations](src/server/tools/).

## Where BasedCode is ahead

- **Checkpoint for every file write**, plus approvals and an audit log for each action. [OpenCode] and [T3] also snapshot with git, but per turn or session rather than per write. [pi] has no checkpoints and no approval prompts.
- **Language-server tools** (`language_rename`, `language_code_actions`, `language_servers`, diagnostics). No other agent here exposes them. [OpenCode]'s new core still has `// TODO: Notify LSP and collect diagnostics after LSP runtime exists` in `file-mutation.ts`.
- **Richer questions**: color, font, radius and slider pickers, live previews, custom HTML.
- **Desktop computer use**: only [Claude] has the same.
- **One safety model for every provider.** [T3] also gives every agent shared tools, but file edits and shell commands still go through each agent's own tools and permission mode. BasedCode turns those off, so its own tools are the only way to act.

## Core agent gaps

### 1. Subagents and delegation — [Codex] [Claude] [OpenCode] [T3]

- **[Codex]** `collaboration.spawn_agent`, follow-up tasks, messages, interrupts, listing and waits.
- **[Claude]** `Agent` (general-purpose, Explore, Plan, custom `.claude/agents/*.md`, or a `fork` with full context), background execution, optional worktree isolation, `SendMessage`/`ListAgents`.
- **[OpenCode]** `subagent` (`tool/plugin/subagent.ts`) starts a background child session and returns a `sessionID` that can be continued. Built-in `general` and `explore` subagents; nesting depth 1; parent permission rules decide which children it may start.
- **[T3]** `delegate_task`, `task_status`, `task_cancel` and `create_threads` (`mcp/toolkits/orchestrator`). A task can go to a **different agent and model** than the caller, and delegated tasks can run in an existing worktree or a new one (`delegatedTaskModes.ts`). It also tracks each provider's own subagents (`TaskCancelNativeSubagent.integration.test.ts`).
- **[pi]** Omitted on purpose: no subagent tool in source. The design post suggests pi run itself through `bash` instead.

BasedCode has user-requested second-opinion chats and `second_opinions`. No tool spawns a worker, scopes its tools, messages it or collects its result. The scheduler serializes runs in overlapping folders, so concurrent workers would also need worktrees (gap 9). [T3]'s cross-agent delegation fits BasedCode well, since BasedCode already runs several providers.

Evidence: [chat tools](src/server/tools/chatTools.ts), [scheduler: `busy` and `pump`](src/server/agent/agent.ts).

### 2. Web search — [Codex] [Claude] [OpenCode]

- **[Codex]** Web and image search, domain/recency filters, link traversal, PDF page screenshots, structured lookups (weather, finance, sports, time).
- **[Claude]** `WebSearch` with standard and extended modes.
- **[OpenCode]** `websearch` (`tool/plugin/websearch.ts`) with pluggable backends: Exa, Firecrawl, Parallel, Tavily and TinyFish. A permission rule gates each query.
- **[T3]** Leaves search to the agent it runs.

BasedCode has `web_fetch` and a browser, but no search engine, image search, citations or rendered PDF pages. [OpenCode]'s design of one tool with several backends would fit BasedCode's provider setup.

Evidence: [`web_fetch`](src/server/tools/terminalTools.ts), [browser tools](src/server/tools/browserTools.ts).

### 3. Model-written tool orchestration — [Codex] [OpenCode] [pi]

> **Added in 1.4.0.** `run_script` runs JavaScript in QuickJS compiled to WebAssembly (no Node, filesystem, network or timers). Scripts call `tools.<name>()`, which goes through the run's guarded tool definitions, so approvals, budgets, the secret guard, checkpoints and tool cards apply as for a direct call ([pi]'s pattern). `ALL_TOOLS`, `text()`/`console.log`, `store()`/`load()` per chat; limits of 200 calls, 10 s of JavaScript between calls and 64 MiB. Not yet: resumable long scripts like [Codex] `functions.wait`. Evidence: [scriptTool.ts](src/server/tools/scriptTool.ts).

- **[Codex]** `functions.exec`: JavaScript that discovers tools through `ALL_TOOLS`, calls several concurrently, keeps values with `store`/`load`, and can yield and resume through `functions.wait`.
- **[OpenCode]** `execute` (`core/src/codemode/`): JavaScript that calls and combines tools. MCP, browser, worktree and session tools are reached through it by default; denying `execute` exposes them as direct tools again.
- **[pi]** `codemode` (`src/extensions/codemode/tool.ts`): scripts use `tools`, `ALL_TOOLS`, `store()`/`load()`, `text()`, `image()` and `models.*`. Nested calls go through the normal tool pipeline, so validation, `tool_call`/`tool_result` hooks and permission checks still apply, and only the script's output reaches the model. Stored values are kept per session branch.
- **[Claude]** No equivalent tool; it makes parallel calls in one turn instead.

BasedCode's `call_tool` runs one deferred tool at a time. [pi]'s design shows how to do this safely: nested calls go through `ctx.executeTool`, the same path a direct call takes. A BasedCode version would need the same, routed through validation, approvals, audit, budgets and checkpoints.

Evidence: [deferred dispatch](src/server/tools/deferred.ts), [tool contracts](src/server/tools/definitions.ts).

### 4. Plan mode — [Claude] [OpenCode]

> **Partly covered.** BasedCode's Planner chat mode ([planner.ts](src/shared/modes/planner.ts)) does the planning workflow and locks the chat after wrap-up, but it only changes the prompt: edit tools stay available. The remaining gap is enforcement, a read-only phase until the user approves the plan.

- **[Claude]** `EnterPlanMode`/`ExitPlanMode`: a read-only phase whose plan the user approves before any edits.
- **[OpenCode]** A primary `plan` agent that can't edit project files except its own plan files.
- **[T3]** Leaves this to the agent. It tracks each thread's mode (`runtime_mode_escalation_denied` in the orchestrator), so an agent can't raise its own permissions.
- **[pi]** Omitted on purpose: use a `PLAN.md`, or limit tools with `--tools read,grep,find,ls`.

BasedCode has `update_plan` and approvals for each action, but no mode that blocks side effects until the user approves a plan.

### 5. Nonblocking questions — [Codex]

- **[Codex]** An asynchronous user-input request: the question stays open while other work continues, and the answer arrives later.
- **[T3]** Has `user_input` requests and `promote_to_steer`; the source doesn't show whether they block.

BasedCode supports `query_async` for live-steerable providers. One text or multiple-choice question can stay open per run while the agent works. Replies arrive through steering. Blocking query tools remain available.

Evidence: [query lifecycle](src/server/tools/queryTools.ts).

### 6. Persistent memory — [Claude]

> **Added in 1.4.0.** Memories are rows in the SQLite store, scoped to one workspace or global. They are added to every system prompt (not in review chats) as background, not instructions. The agent has `memory_save` (create or update) and `memory_delete`; **Settings → Memory** lists, filters, adds, edits and deletes them and can turn memory off. Limits: 600 characters each, 200 per scope, 12,000 characters per prompt. Evidence: [memory.ts](src/server/agent/memory.ts), [MemoryPanel.vue](src/app/components/settings/MemoryPanel.vue).

- **[Claude]** File-based memory (a `MEMORY.md` index plus one fact per file) that the agent writes and every session loads.
- **[pi]** Context files (`AGENTS.md`) only. **[OpenCode]** discovers instructions (`instruction-discovery.ts`) but has no memory tool.

BasedCode loads `AGENTS.md`/`CLAUDE.md`, but has no store or tool for cross-session memories the agent writes itself.

Evidence: [project instructions](src/server/agent/instructions.ts).

### 7. Hooks, plugins and extensions — [Claude] [OpenCode] [pi] [Codex]

- **[Claude]** User-configured hooks (`PreToolUse`, `PostToolUse`, `Stop` and others) in `settings.json`, plus plugin bundles of skills, hooks, agents and commands.
- **[OpenCode]** Plugins (`packages/plugin`, `core/src/plugin.ts`): built-in tools are plugins themselves, and plugin tools enforce their own permissions.
- **[pi]** Extensions get lifecycle events (`src/core/extensions/types.ts`): `tool_call`, `tool_result`, `before_agent_start`, `turn_start`/`turn_end`, `before_provider_request`, `session_before_compact`, `session_before_fork`, `session_tree` and more. They can block tool calls, add tools and change the UI, and they ship as npm/git packages. Project trust gates extensions found in `.pi/`.
- **[Codex]** Plugins exist, but no user hook lifecycle was observed.

BasedCode supports workspace checks before and after agent runs. Before-run checks use the command approval flow and must pass before the agent starts. Tool-call hooks and plugin bundles are still open. [pi]'s event list is a reference for additional hook points.

### 8. Scheduling, goals and continuation — [Codex] [Claude] [OpenCode] [T3]

- **[Codex]** Automations (scheduled tasks, reminders, monitors, future chat wakeups), plus `create_goal`/`get_goal`/`update_goal` with progress and token budgets.
- **[Claude]** `CronCreate`/`CronList`/`CronDelete`, `ScheduleWakeup` (`/loop`), `RemoteTrigger`, scheduled tasks and cloud routines. No goal tool.
- **[OpenCode]** `automation_create`, `automation_list`, `automation_pause`, `automation_resume`, `automation_delete` (`tool/plugin/automation.ts`), backed by cron schedules stored in SQLite (`core/src/automation.ts`).
- **[T3]** `schedule_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `run_scheduled_task_now` (`apps/server/src/scheduledTasks/`).

BasedCode has queued runs, `prompt_time_limit` and push notifications. Nothing starts future work, repeats a check or keeps an unfinished goal running.

Evidence: [notifications](src/server/integrations/notify.ts), [run scheduling](src/server/agent/agent.ts), [deadline tool](src/server/tools/chatTools.ts).

### 9. Managed worktrees — [Codex] [Claude] [OpenCode] [T3]

> **Added in 1.4.0.** `worktree_list`, `worktree_create` and `worktree_remove` (create and remove need approval), plus **New worktree** and **Remove worktree** in the sidebar's workspace menu. A worktree is created beside the repository in `<repo>.worktrees/<branch>` with Git hooks disabled, and opens as its own workspace linked to its origin (`worktreeOf`). Removal refuses uncommitted changes unless forced and keeps the branch. Not yet: [T3]'s merge back, and a chat moving itself into a worktree. Evidence: [worktrees.ts](src/server/server/worktrees.ts), [worktreeTools.ts](src/server/tools/worktreeTools.ts).

- **[Codex]** Worktree create, status, attach, archive and restore, tied to chats.
- **[Claude]** `EnterWorktree`/`ExitWorktree`, `isolation: "worktree"` for subagents, cleanup tools.
- **[OpenCode]** `worktree_create`, `worktree_list`, `worktree_remove` (`core/src/worktree/`). Only removal asks for permission.
- **[T3]** A worktree per thread, a worktree toolkit with **merge back** (`mcp/toolkits/worktree`, `merge_back`), and delegated tasks that reuse an `existing_worktree`.

BasedCode can run `git worktree` through an approved command, but has no app-managed worktree tied to a chat.

Evidence: [Git tools](src/server/tools/gitTools.ts), [workspace RPCs](src/server/server.ts).

### 10. Full MCP discovery and events — [Codex] [Claude] [OpenCode]

- **[Codex]** Resource-template discovery and cursor-based resource listing.
- **[Claude]** `ListMcpResourcesTool`, `ReadMcpResourceDirTool`.
- **[OpenCode]** `list_mcp_resources`, `read_mcp_resource` and **`watch_mcp_event`** (`tool/plugin/mcp-events.ts`), so the agent can wait for an MCP server's notifications.
- **[pi]** Tools and resources over stdio or streamable HTTP (`docs/mcp.md`). **[T3]** Bridges MCP into ACP agents (`AcpMcpStdioBridge.ts`) and renders MCP apps (`apps/server/src/mcpApps`).

BasedCode paginates tools, resources, resource templates, and prompts. Agents can request a resource or template page with an opaque cursor, read a known URI, and wait for the next server notification with a timeout.

Evidence: [`McpConnections.discover`](src/server/integrations/mcp.ts).

### 11. Image generation — [Codex] [OpenCode]

- **[Codex]** `image_gen.imagegen`, including edits with reference images and transparent output.
- **[OpenCode]** `experimental_image_generate` (`tool/plugin/image-generate.ts`). Its core also has video generation and realtime voice services (`video-generation.ts`, `voice.ts`); the source doesn't show them registered as agent tools.
- **[pi]** `codemode` scripts can reach image models through `models.*`.

BasedCode can inspect and show images, but can't generate them.

### 12. Artifacts and persistent compute — [Codex] [Claude] [OpenCode]

> **Added in 1.4.0.** `artifact_create`, `artifact_update` (full content or exact-text edits), `artifact_read`, `artifact_list` and `artifact_delete`. Artifacts are stored per workspace with up to 50 versions each, outside the workspace files, and show in the chat with a version picker: HTML in the same sandboxed frame as `render_ui`, plus Markdown, SVG, JSON, CSV and plain text. Persistent compute is `run_script`'s `store()`/`load()`, kept per chat. Not yet: sharing or publishing, comments, a persistent REPL kernel, and editing spreadsheets or decks like [Codex]. Evidence: [artifactTools.ts](src/server/tools/artifactTools.ts), [ArtifactView.vue](src/app/components/visuals/ArtifactView.vue).

- **[Codex]** A persistent Node REPL, plus `artifact_session` for editing spreadsheets, decks and canvases bound to a viewer.
- **[Claude]** `Artifact` publishes private, shareable, versioned pages with comments (`ArtifactComments`), a shared database (`ArtifactData`) and templates; Claude Docs for editable documents.
- **[OpenCode]** `artifact_create`, `artifact_read`, `artifact_update`, `artifact_delete` (`tool/plugin/artifact.ts`): files with a MIME type tied to a session, through pluggable providers (`core/src/artifact.ts`).

BasedCode's widgets exist only inside the chat. It has no artifact store, publishing, comments or version history.

### 13. Real browser and devices — [Codex] [Claude] [T3]

- **[Codex]** Discovers and attaches to existing browser tabs, resolves tab mentions, creates tabs.
- **[Claude]** Claude in Chrome (`mcp__claude-in-chrome__*`): the user's real Chrome with their sign-ins, multiple tabs, GIF recording, file upload.
- **[T3]** An app-owned preview browser (`preview_open`, `preview_navigate`, `preview_snapshot`, `preview_act`, `preview_evaluate`, `preview_resize`, `preview_set_appearance`, `preview_dialog`, `preview_wait_for`, `preview_recording_start`/`stop`), plus **mobile devices and simulators** (`device_list`, `device_open`, `device_screenshot`, `device_close`).

BasedCode's Camoufox browser covers most of [T3]'s preview tools, but not light/dark appearance switching, recording or devices. It also has no access to the user's real browser and no tab inventory.

Evidence: [browser tools](src/server/tools/browserTools.ts).

## App-level gaps

### 14. Session, sidebar and window management — [Codex] [Claude] [T3] [OpenCode]

- **[Codex]** List and read chats and projects, create and fork chats, send messages, wait, hand off, archive, move, manage sidebar sections.
- **[Claude]** `mcp__ccd_session__*`, `mcp__ccd_session_mgmt__*` (list, read and search transcripts, send, archive, stop, set model/effort/permission mode), `mcp__ccd_sidebar__*`, `mcp__ccd_window__*`, `mcp__ccd_view__*`.
- **[T3]** Thread tools (`mcp/toolkits/thread`): rename, pin, unpin, snooze, settle, archive, mark unread, regenerate title; a message tool that posts Markdown; access checks per thread (`threadAccess.ts`, `McpToolAccess.ts`).
- **[OpenCode]** `session_rename`, `session_move`.

The BasedCode app already creates, forks, archives, pins, moves, hands off and steers chats. Agents can rename the current chat, search and read earlier chats in the workspace, and pin, unpin, archive or unarchive workspace chats with explicit approval. Other session actions remain an exposure gap. [T3]'s `McpToolAccess` (capabilities such as `reads`, `writes_threads`, `starts_threads`, plus `capability_denied`) is a worked example of putting access checks on these tools.

Evidence: [RPC dispatch](src/server/server.ts), [chat tools](src/server/tools/chatTools.ts).

### 15. PRs, issues and shipping — [T3] [Claude] [Codex]

- **[T3]** PR tools (`link_pull_request`, `list_thread_pull_requests`, `watch_pull_request`, `read_pull_request_guide`, `write_pull_request_guides`) over seven hosts (`packages/source-control-*`: GitHub, GitLab, Bitbucket, Azure DevOps, Forgejo and others). Issue tools (`list_issues`, `read_issue`, `create_issue`, `comment_on_issue`, `set_issue_state`, `link_issue`) with a Linear package. One-click commit, push and PR in the app.
- **[Claude]** `mcp__ccd_pr__*`: bind a PR, watch CI, auto-fix, auto-merge.
- **[Codex]** GitHub and code-review connectors.

BasedCode has local Git but no push, PR, issue or CI awareness.

### 16. Remote and mobile control — [T3] [Claude] [pi] [OpenCode]

> **Partly covered.** BasedCode already serves its UI and API remotely through a Cloudflare quick tunnel, with the access code in the URL hash ([remote.ts](src/server/integrations/remote.ts)). The remaining gap is a mobile app, remote hosts over SSH, and cloud handoff.

- **[T3]** Web, iOS and Android clients (`apps/mobile`) sharing the same threads; remote hosts over SSH and Tailscale (`packages/ssh`, `packages/tailscale`); relay and cloud modules.
- **[Claude]** Remote control and cloud sessions (`move_to_cloud`).
- **[pi]** Headless RPC and JSON modes and a TypeScript SDK (`docs/rpc.md`, `docs/sdk.md`), so other apps (including [T3]) can drive it.
- **[OpenCode]** `opencode pair` makes a one-time link to the web interface.

BasedCode has remote-access integration code ([integrations](src/server/integrations/)), but no mobile client, remote hosts or cloud handoff.

### 17. Secrets and managed policy — [T3]

- **[T3]** `request_secret` lets the agent ask the user for a secret, with 1Password as a provider (`packages/secret-provider-onepassword`). Managed policy for organisations: allowed providers, limits, settings and update channels (`apps/server/src/policy/`).
- **[OpenCode]** Also has managed policy (`core/src/managed-policy.ts`).

BasedCode has no way for the agent to ask for a secret without the secret passing through the chat, and no admin-managed policy.

### 18. Other agent-facing utilities — [Claude] [Codex] [OpenCode]

| Utility | From | BasedCode status |
| --- | --- | --- |
| Agent sends a push notification | [Claude] `PushNotification` | `send_push_notification` supports desktop alerts and the configured push destination with explicit approval. Desktop alerts can also notify about pending approvals and agent questions. |
| Open in editor, reveal in file manager, keep awake | [Claude] `mcp__ccd_host__*` | `open_workspace_file` supports editor and file manager actions with explicit approval. The desktop app can opt in to keeping the host awake during active runs. |
| Add or switch working directory | [Claude] `mcp__ccd_directory__*`, [OpenCode] `session_move` | Missing. |
| Query usage and limits | [Claude] `get_usage`, [Codex], [OpenCode] `usage-limits.ts` | `get_usage` reports workspace totals and cached limits for enabled provider kinds. |
| Change settings with approval | [Claude] `mcp__ccd_settings__*` | Missing. |
| Surface a file to the user | [Claude] `SendUserFile`, [T3] attachment toolkit | `send_user_file` attaches a downloadable workspace file with explicit approval. |
| Screen capture, update check, voice, chat sharing | [Codex], [OpenCode] `voice.ts`, [T3] `speech/` | `check_app_update` checks for updates after approval. `computer_screenshot` captures the Windows desktop with approval. Voice and chat sharing are open. |

## Optional ecosystem gaps

These depend on the account and connected services; they aren't core to a coding agent. BasedCode's MCP support is the foundation, but it does not bring over authenticated connectors or hosted backends.

| Capability | From |
| --- | --- |
| GitHub, GitKraken/GitLens, code-review connectors | [Codex] [Claude] |
| Linear issues, multi-host source control | [T3] |
| Atlassian (Jira, Confluence) | [Claude] |
| Outlook, Spotify, Figma, Postman, Sites hosting | [Codex] |
| Plugin and connector catalogue, MCP registry | [Codex] [Claude] |
| Local models via llama.cpp | [pi] (built-in extension) |
| Bundled document authoring (docx, pptx, xlsx, pdf) | [Codex] [Claude] |
| Pets, safety settings, helpline lookup | [Codex] |

BasedCode discovers skill folders under `.basedcode`, `.claude`, `.codex` and `.agents`, but not plugin-cache packages or cloud skill catalogues. [Codex] [Claude]

## Priority

1. **Subagents** (gap 1): in four of five products. [T3]'s cross-agent `delegate_task` suits BasedCode's multi-provider design.
2. **Web search** (gap 2): every full agent except pi has it. [OpenCode]'s one tool with several backends is a good model.
3. **Managed worktrees** (gap 9): in four products, and needed before subagents can run concurrently.
4. **Scheduled work** (gap 8): now in four products, including [OpenCode] and [T3].
5. **Plan mode** (gap 4): cheap to build on top of the existing approvals.
6. **Tool orchestration** (gap 3): three products have it; follow [pi]'s pattern so nested calls go through the normal pipeline.
7. **Hooks/extensions** (gap 7) and **memory** (gap 6).
8. **Session tools** (gap 14) with [T3]-style capability checks, then PRs/issues (15), remote clients (16) and secrets (17).
9. Image generation (11), artifacts (12) and devices (13): depend on product scope. MCP discovery and event watching (10) are available.

The comparison also shows where BasedCode should stay different. [pi] has no approvals and points users to containers, while [T3] gives agents shared tools but leaves file and shell access to each provider. BasedCode is the only one here where every side effect goes through one approval and checkpoint path. New features should keep that true.

## Constraints

Keep provider isolation. BasedCode switches off each provider's native tools on purpose:

- **Codex:** private `CODEX_HOME`, disabled feature flags, declined server requests and a stream guard ([providerPolicy.ts](src/server/agent/providerPolicy.ts), [AGENTS.md](AGENTS.md)).
- **Claude:** the Agent SDK runs with `tools: []`, `settingSources: []`, `plugins: []`, `hooks: {}`, `strictMcpConfig`, `allowedTools` limited to `mcp__basedcode__*`, and a `canUseTool` that denies everything else ([agent.ts](src/server/agent/agent.ts)).

Close the gaps above with BasedCode tools that go through the permission, approval and checkpoint paths, not by re-enabling native provider tools.

## Validation limits

- No builds, tests or connected-service calls were run, for BasedCode or the three cloned repos.
- [Codex] and [Claude] findings come from live tool contracts. The GitKraken MCP server failed to connect during the [Claude] audit, so its tools came from listed names only.
- [OpenCode], [pi] and [T3] findings come from shallow clones of their default branches on 2026-11-17, found by reading tool registrations, file names and doc headers. Tool names are reliable; behaviour described from a file name or a single grep (marked as such above) may be wrong in detail.
- [OpenCode] is in the middle of a rewrite (`packages/core`). This audit follows the new core, so features that exist only in the old code may be missing.
- Third-party MCP servers configured in BasedCode may close some gaps; they were not audited.
