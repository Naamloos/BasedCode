# AGENTS.md

Instructions for AI coding agents working on BasedCode. Read this before changing anything.

BasedCode is a desktop app (NW.js window, Vue 3 UI, local Node backend) that runs AI coding agents against a user's project folder through its own tools, approvals and checkpoints. See [README.md](README.md) for what it does.

## Layout

All app code lives in `src/`, split by where it runs:

```
src/
  app/      Vue 3 UI, runs in the NW.js window
  server/   local Node backend (TypeScript run with tsx)
  shared/   types and contracts used by both
desktop/    NW.js window host
scripts/    startup, runtime download, Windows packaging
installer/  Inno Setup script and launcher
```

**`src/server/`**

- `server.ts`: startup, HTTP transport, authentication and RPC dispatch. `server/`: RPC schemas, updates and usage reporting.
- `agent/`: run orchestration, the local loop, project instructions, conversation context, provider policy, failure classification and prompts.
- `tools/`: tool registration and handlers (file, terminal, Git, language, integration, visual). The registry owns validation, takeover waits and auditing; each group owns its schemas and behavior. `definitions.ts` holds the common contracts.
- `providers/`: provider discovery, credentials, CLI adapters, pricing and limits.
- `runtime/`: process and terminal lifecycle, command output parsing.
- `workspace/`: filesystem boundaries, permissions, checkpoints, atomic writes and Git diff parsing.
- `integrations/`: MCP, language servers and remote access. `storage/`: SQLite persistence and app events.

**`src/app/`**

- `App.vue`: composition, navigation and coordinated workspace/chat actions. `main.ts` and `mcpUiFrame.ts` are the Vite entry points (`index.html`, `mcp-ui.html`).
- `components/`: grouped by chat, workspace, settings, usage, models, visuals and common.
- `state/`: focused state (attachments, pane layout, drafts, approvals, dialogs, keybindings). `services/`: backend transport and native window.
- `theme/`, `locales/`: appearance, effects and translations. `utils/`, `visuals/`: helpers and charts.
- `styles/`: global CSS. `style.css` is the ordered entry point; keep the import order, later files override earlier ones.

**`src/shared/`** holds API/data types and preview rules only. No server or browser lifecycle code; `app/` and `server/` must not import each other.

Prefer extending an existing module over adding a new layer. Keep tests next to the module they cover (`foo.ts` → `foo.test.ts`).

## Commands

Requires Node.js 24 or newer.

```bash
npm install
npm run dev        # dev mode with hot reload (Vite on 127.0.0.1:5317)
npm run typecheck  # vue-tsc over src/
npm run lint       # eslint, zero warnings allowed
npm test           # node:test via tsx
npm run build      # Vite build into dist/ui
```

Before you call a change done, run `npm run typecheck` and `npm test`, and lint the files you touched (`npx eslint <files>`). If a check was already failing before your change, say so instead of hiding it.

## Code conventions

- TypeScript strict mode everywhere. Validate RPC input with the zod schemas in `src/server/server/schemas.ts`.
- Match the style of the file you are editing (formatting, naming, comment density). Prettier is available; don't reformat code you didn't change.
- Comments explain *why*, not what. Keep them short.
- Safety is the product: anything that runs commands, writes files or touches Git must go through the permission, approval and checkpoint paths in `src/server/workspace/` and `src/server/tools/`. Never add a side-effecting path that skips them.

## Codex native tools

Provider CLIs must only act through BasedCode's own tools (`mcp__basedcode__*`), never their built-in shell or file tools. For Codex this is enforced in layers; keep all of them when you change the adapter:

1. A private `CODEX_HOME` (`src/server/providers/codexHome.ts`) with only `auth.json` copied from the user, and BasedCode's own `config.toml`.
2. Feature flags in `codexDisabledFeatures` (`src/server/agent/providerPolicy.ts`). `unified_exec` cannot actually be turned off in codex-cli 0.156.1; `shell_tool=false` is what removes the native shell.
3. Server-request handlers that decline command, file-change and skill approvals and stop the run.
4. A stream guard that aborts the run on any tool call that is not a BasedCode tool.

## UI text and translations

- Write UI strings in plain English and wrap them in `t('...')`. The English text is the translation key.
- Add the Dutch translation to `src/app/locales/nl.ts`. `src/app/locales/based.ts` ("Based" slang) is optional; missing keys fall back to English.
- Never translate model output, user content, file paths or provider/model names.
- New visual effects must respect the "effects off" setting.

## Commits

Commits are checked by commitlint ([commitlint.config.js](commitlint.config.js)) through a husky `commit-msg` hook. Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <summary in imperative mood>
```

| Type | Use for |
| --- | --- |
| `feat` | A new user-facing feature |
| `fix` | A bug fix |
| `perf` | A performance improvement |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `style` | Formatting only, no behavior change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `build` | Dependencies, packaging, installer |
| `ci` | GitHub Actions workflows |
| `chore` | Other maintenance |
| `revert` | Reverting an earlier commit |

Scopes are optional; use the area you changed, such as `chat`, `settings`, `tools`, `providers` or `installer`. Don't add AI attribution trailers (such as `Co-Authored-By`) to commit messages.

Only commit or push when asked. Releases are cut by bumping `version` in `package.json` on `master` (see `.github/workflows/release.yml`), so don't change the version unless asked.
