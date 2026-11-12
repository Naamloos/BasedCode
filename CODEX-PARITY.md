# Codex tool parity

Audit date: 2026-11-12.

Compared BasedCode's current working-tree implementation with the tools exposed to this Codex desktop session, including discoverable app/plugin tools. This is a source and tool-contract audit, not a runtime test or a claim about every Codex installation. Account access, configured MCP servers and provider support can change what actually works.

“Missing” below means missing from BasedCode's registered agent tools unless explicitly described as an app-level gap. A shell workaround or a configurable MCP integration is not the same as built-in support. Conversely, a different tool name does not imply a missing capability.

## Already covered

| Capability | BasedCode equivalent |
| --- | --- |
| Read, search, inspect and edit workspace files | `read_file`, `read_files`, `search`, `find_files`, `file_outline`, `write_file`, `apply_patch`, `edit_lines`, `move_file`, deletion and metadata tools. |
| Execute commands and interact with running processes | `run_command`, `terminal_output`, `terminal_input`, `stop_terminal`; `run_checks` also provides structured verification results. |
| Inspect local images | `view_image`; image delivery depends on the provider. |
| Drive a browser | Navigation, inspection, clicks, filling, keyboard/scroll interactions, screenshots, waits, logs and session controls. |
| Ask structured questions | Text, yes/no, choices, sliders, colors, fonts, corner radii, live previews and custom HTML queries. |
| Show interactive output | `render_ui`, `render_chart`, `render_diagram`, `show_image`, bundled widget libraries and attachment access. |
| Track a checklist | `update_plan`. |
| Discover deferred tools | `load_tools` and `call_tool`. |
| Use external tools and resources | `list_mcp`, `call_mcp`, `read_mcp_resource`, `get_mcp_prompt`, server installation, OAuth and embedded MCP app views. |
| Load and author local skills | `list_skills`, `activate_skill`, `create_skill`, workspace/global skill directories. |
| Read documents | `extract_document` supports PDF, Office, OpenDocument, EPUB and other formats, including ranges and embedded images. |
| Get the current time and manage a prompt deadline | `prompt_time_limit` checks time/remaining duration and enforces a user-requested deadline. |
| Rename the current chat and read reviews | `set_chat_title`, `second_opinions`. |

Evidence: [tool registration](src/server/tools/tools.ts), [deferred groups](src/server/tools/deferred.ts), [tool implementations](src/server/tools/), [widget libraries](src/server/tools/widgetLibraries.ts).

## Core agent gaps

### 1. Model-authored tool orchestration

Codex exposes `functions.exec`: JavaScript can discover tool metadata through `ALL_TOOLS`, call multiple tools, compose their results, run independent calls concurrently, retain serializable values with `store`/`load`, and emit text or media. Long executions can yield and resume through `functions.wait`.

BasedCode's `load_tools`/`call_tool` discovers and invokes one deferred tool at a time. There is no equivalent registered tool for model-authored JavaScript orchestration, value storage, selective result emission or resumable orchestration. `read_files` batches reads, but does not cover arbitrary combinations of tools. This does not establish whether an individual provider can issue concurrent ordinary calls.

Any equivalent must dispatch through existing validation, approvals, auditing, budgets and checkpoint paths; exposing unrestricted Node would bypass the product's safety boundary.

Evidence: [deferred dispatch](src/server/tools/deferred.ts), [registration wrapper](src/server/tools/tools.ts), [tool contracts](src/server/tools/definitions.ts).

### 2. Agent-controlled delegation

Codex exposes `collaboration.spawn_agent`, follow-up tasks, messages, interruption, agent listing and completion waits. Child agents have separate conversations and can return results to their parent.

BasedCode has user-requested second-opinion review chats and a tool to read their results. It has no registered tool to spawn a worker, assign a task, message it, stop it or wait for its result. Reviews are therefore partial overlap, not a general delegation interface. Its scheduler also serializes runs in overlapping workspace folders, so simply exposing chat creation would not provide concurrent workers in the same checkout.

Evidence: [chat tools](src/server/tools/chatTools.ts), [review creation](src/server/server/features.ts), [scheduler: `busy` and `pump`](src/server/agent/agent.ts).

### 3. Questions that leave the agent working

Codex exposes an asynchronous user-input request: the question remains available while independent work continues, and a reply arrives later.

BasedCode's query tools await a promise resolved by submission or cancellation. There is no explicit nonblocking question tool with a pending-question handle and later answer delivery. Multiple ordinary calls from a particular provider are not a provider-independent replacement for that contract.

Evidence: [query lifecycle](src/server/tools/queryTools.ts).

### 4. Persistent goals and automatic continuation

Codex exposes `create_goal`, `get_goal` and `update_goal`, including progress state and optional token budgets. These are separate from a visible task checklist.

BasedCode has `update_plan`, run budgets and prompt deadlines, but no registered persistent goal lifecycle or goal-driven continuation interface. A deadline stops a prompt; it does not keep an unfinished objective running across turns.

Evidence: [plan tool](src/server/tools/visualTools.ts), [deadline tool](src/server/tools/chatTools.ts), [shared state contracts](src/shared/types.ts).

### 5. Search-backed web research

Codex exposes web and image search, domain/recency filters, page opening, link traversal, text finding, PDF page screenshots and structured lookups such as weather, finance, sports and time.

BasedCode provides `web_fetch` for a known public URL and a real browser. It has no registered search engine interface, image search, source-reference/citation system, PDF page screenshot tool or structured data feeds. Browser browsing and `extract_document` cover parts of the workflow, but do not provide search ranking, source handles or rendered PDF pages. An external MCP server could supply these features if configured.

Evidence: [`web_fetch`](src/server/tools/terminalTools.ts), [browser tools](src/server/tools/browserTools.ts), [document extraction](src/server/tools/documents.ts).

### 6. Persistent computation and live artifact editing

Codex exposes a persistent Node REPL with top-level await, imports, retained bindings and image output. It also exposes `artifact_session` for editing viewer-bound spreadsheets, presentations and an existing bound canvas, plus tools to locate bundled document libraries and attach/list artifacts.

BasedCode has terminals, document extraction and sandboxed HTML widgets. It has no registered persistent computation kernel, live workbook/deck/canvas model, artifact attachment/catalog API or document-authoring runtime discovery tool. Commands and installed libraries can still generate files; the gap is a managed authoring workflow and editable viewer state. Extraction is not visual PDF rendering or Office authoring.

Evidence: [terminal tools](src/server/tools/terminalTools.ts), [visual tools](src/server/tools/visualTools.ts), [document extraction](src/server/tools/documents.ts), [widget libraries](src/server/tools/widgetLibraries.ts).

### 7. Image generation and editing

Codex exposes `image_gen.imagegen` for new raster images and edits using reference images, including transparent output.

BasedCode can inspect and display images, but has no registered image-generation/editing service. Generating an SVG, drawing to canvas or taking a screenshot does not supply the same capability. This could be an approved external integration rather than a local implementation.

Evidence: [image reading](src/server/tools/fileTools.ts), [image display](src/server/tools/visualTools.ts), [registered tool groups](src/server/tools/tools.ts).

### 8. Existing-browser and multi-tab access

This session's browser interface can discover available browser surfaces, select existing tabs, resolve tab mentions and create tabs in supported browsers.

BasedCode owns an isolated Camoufox browser with one tracked page per chat session. Its tools do not expose discovery/attachment to the user's existing Chrome/Edge tabs, a tab inventory or tab switching. Its existing browser controls and live preview should not be counted as missing.

Native Windows app control is disabled in this Codex session, so this audit does not claim a working native-desktop-control advantage.

Evidence: [browser session and page ownership](src/server/tools/browserTools.ts).

### 9. Full MCP resource discovery

Codex exposes resource-template discovery and cursor-based resource listing in addition to reading a known resource URI.

BasedCode's `list_mcp(serverId)` discovers tools, resources and prompts, but `McpConnections.discover` only paginates tools. It retrieves one page of resources/prompts and does not list resource templates. Consequently, parameterized resources and resources beyond the initial listing are not fully discoverable through the current wrapper. Reading an already-known URI is supported.

Evidence: [`McpConnections.discover` and `resource`](src/server/integrations/mcp.ts), [integration tools](src/server/tools/integrationTools.ts).

## App features missing an agent interface

### 10. Chat, project and sidebar management

Codex exposes tools to list/read chats and projects, create/fork chats, send messages, wait for updates, hand off work, rename/archive chats, move items and manage custom sidebar sections.

BasedCode already implements chat creation, forking, archiving, pinning, moving, handoff, steering and other actions in its app RPC/UI. The registered agent surface exposes only current-chat title changes and review reading. Missing agent capabilities include finding/reading other chats, creating/forking them, sending work, waiting for results, archiving/moving chats and inspecting/managing projects. Custom sidebar-section management is also absent from the inspected agent tools and shared state contracts.

This is primarily an exposure gap: reuse the existing app operations and enforce access boundaries rather than inventing a second chat system. App RPC availability alone does not make an operation an approved agent tool.

Evidence: [RPC dispatch: `chat.*`, `workspace.*`, `run.submit`, `run.steer`](src/server/server.ts), [chat tools](src/server/tools/chatTools.ts), [chat state](src/shared/types.ts).

### 11. Scheduled work and notifications tied to future conditions

Codex exposes automation management for scheduled tasks, reminders, monitors and future chat wakeups.

BasedCode has queued runs, deadlines and push notifications, but no registered automation-management tools or automation state in the inspected shared contracts/RPC surface. Notifications about a running task are not a scheduler that starts future work or repeatedly monitors a condition.

Evidence: [RPC surface](src/server/server.ts), [notification integration](src/server/integrations/notify.ts), [run scheduling](src/server/agent/agent.ts), [shared state](src/shared/types.ts).

### 12. Managed worktree lifecycle

Codex exposes worktree creation/status, attachment, archival and restoration tools integrated with chats.

BasedCode has Git operations and workspace opening, but no registered managed-worktree lifecycle or chat/worktree association. Running `git worktree` through an approved command is a workaround; it does not provide app-managed ownership, creation status or restoration.

Evidence: [Git tools](src/server/tools/gitTools.ts), [workspace RPCs](src/server/server.ts), [workspace/chat contracts](src/shared/types.ts).

## Optional ecosystem gaps

The following are tools exposed in this session, not universal requirements for a coding agent. BasedCode's generic MCP support is a foundation, but does not automatically bring over authenticated connections, plugin skills, hosted backends or app-specific UI behavior.

| Session capability | What BasedCode lacks out of the box |
| --- | --- |
| GitHub, GitKraken and code-review tools | Hosted repository/PR/issue/review integrations equivalent to these connected tools. Local Git support already exists. |
| Outlook email and Spotify | The connected account tools and their service-specific skills. |
| Figma | Connected design/spec tools, file-context JavaScript, design-to-code context and design authoring workflows. |
| Sites | Managed site creation/deployment, hosting, access/domain management and database tools. A local preview is a separate capability. |
| Postman | Connected collections, environments, specifications and mock-server workflows. |
| Plugin creation and management | A packaged plugin lifecycle combining tools, skills, permissions and app UI. BasedCode already has an MCP marketplace, server installation and local skills. |
| Connected document sessions | Session discovery and direct editing of a document open in a connected app. Local extraction and generated files cover different workflows. |
| Pets, safety settings and helpline lookup | These service-specific tools/backends; they are optional ecosystem differences. |
| Desktop app utilities | Agent-facing usage-limit queries, screen-context capture, app-update checks, realtime voice-call control and chat sharing. BasedCode has usage reporting and update RPCs, but these are not registered agent tools. |

Evidence: this session's discoverable tool contracts; [BasedCode integration wrapper](src/server/tools/integrationTools.ts), [MCP client](src/server/integrations/mcp.ts), [app RPCs](src/server/server.ts), [skill discovery](src/server/agent/skills.ts).

Local skill-directory compatibility also does not load the plugin skills supplied to this session: BasedCode enumerates immediate skill folders under `.basedcode`, `.claude`, `.codex` and `.agents`; it does not discover this session's plugin-cache packages or cloud skill catalog.

## Priority and constraints

For coding-agent parity, the highest-value gaps are tool orchestration, delegated workers, search-backed research, chat-management tools and complete MCP resource discovery. Nonblocking questions, managed worktrees, goals and scheduled work extend longer-running workflows. Image generation, live artifact runtimes and service connectors depend on the intended product scope.

Keep BasedCode's provider isolation. Its Codex policy deliberately disables native shell, apps/plugins, browser/computer use, image generation, multi-agent, worktrees and other bypass paths. Missing features should be supplied through BasedCode's own approved tools; enabling provider-native access would undermine the existing boundary. `code_mode_host` is intentionally retained for dispatching supplied MCP tools, but does not itself establish a BasedCode orchestration contract.

Evidence: [provider policy](src/server/agent/providerPolicy.ts), [safety requirements](AGENTS.md).

## Validation limits

No builds, tests, browser sessions, external documentation lookups or connected-service calls were run. Findings are based on the source present during this audit and the tool definitions exposed to this session. Existing uncommitted changes were included as current behavior and left untouched. Configured third-party MCP servers may close individual gaps; their configuration and runtime behavior were not audited.
