<p align="center">
  <img src="desktop/icon.png" alt="BasedCode logo" width="160">
</p>

# BasedCode

BasedCode is a desktop app for coding with AI agents. Open a project folder, pick a model and give it a task. The agent reads files, edits code and runs commands through BasedCode's tools. You control approvals and can review diffs or restore files from checkpoints.

It works with Claude Code, Codex and Antigravity (through your existing CLI login) and with local models through Ollama or LM Studio. Every provider gets the same tools, permissions and history, so you can switch models in the middle of a chat.

You can enable fire effects and the "Based" slang language in settings. The app starts in English with effects off.

## Screenshots

<table>
  <tr>
    <td align="center" width="50%"><img src=".github/screenshots/chat.png" alt="A chat where the agent explains how commit messages are checked"><br><sub>The agent answers a question, reading files through BasedCode's tools.</sub></td>
    <td align="center" width="50%"><img src=".github/screenshots/home.png" alt="The start screen of a workspace with suggested tasks"><br><sub>Start a chat or pick a suggested task.</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src=".github/screenshots/commands.png" alt="The slash command menu with guided modes"><br><sub>Type <code>/</code> for commands and guided modes.</sub></td>
    <td align="center" width="50%"><img src=".github/screenshots/models.png" alt="The model settings with Claude Code and Ollama"><br><sub>Set up providers and their fallback order.</sub></td>
  </tr>
</table>

## Features

- **Agent chats in your project.** The agent explores, explains, plans and changes code in the folder you opened. Plain chats without a project run in a scratch folder of their own.
- **Approvals you control.** Terminal commands and Git changes need your approval. Set allow and deny rules for commands, and per-run budgets for tool calls, tokens and cost. A secret guard asks before a likely secret leaves your machine.
- **Review and undo.** See the diff of every prompt, and revert the workspace to any earlier prompt. Fork a chat from any message, re-run a prompt, or ask a second model for a second opinion and compare the results.
- **Provider fallback.** Put providers in order per workspace. When one runs out of quota, the next one continues the same chat.
- **Built-in workspace tools.** A file tree, a terminal, a Git panel that stages, commits and pushes with a written message, and diagnostics from language servers (TypeScript, Vue, Python, C# and more).
- **MCP servers and skills.** Add MCP servers (including from a built-in marketplace) and skills. Skills load from `.basedcode/skills/<name>/SKILL.md` in a workspace, or globally from `~/.basedcode/skills`, `~/.claude/skills`, `~/.codex/skills` and `~/.agents/skills`. `AGENTS.md` and `CLAUDE.md` project instructions load automatically.
- **Usage tracking.** See tokens, cost and provider limits per chat, per model and over time.
- **Remote access.** Open BasedCode from your phone through a Cloudflare tunnel (needs `cloudflared`), and get push notifications for approvals and finished prompts.
- **Themes and languages.** Dark and light themes, a theme editor, and the UI in English, Dutch or Based.

## Guided modes

A guided mode gives the agent a role for the whole chat. Type the command in the message box, or pick the mode from the new-chat menu. Each mode has a **Wrap up** button that ends the session with a report, such as a debugging report, a test coverage summary or a postmortem.

| Command | Mode | What it does |
| --- | --- | --- |
| `/duck` | Rubber duck | Explain your bug; the agent asks questions, reproduces it and tests ideas with you. It doesn't change code unless you ask. |
| `/pair` | Pair programming | Plan a change together, then you write it while the agent guides, reviews and explains. |
| `/plan` | Planner | Turns an idea into a written implementation plan with scope, design, ordered tasks and risks. It doesn't write the code. |
| `/dig` | Archaeology | Traces code paths, dependencies and Git history to explain why code is the way it is and what a change would break. Read-only. |
| `/devil` | Devil's advocate | Argues against your design, questions assumptions, hunts edge cases and pitches alternatives. |
| `/grill` | Grill | Questions your design one decision at a time to uncover missing requirements and assumptions. |
| `/refactor` | Refactor | Refactors code in small steps and runs tests after each change to check for regressions. |
| `/tests` | Test architect | Designs a test plan for a feature, then writes and runs the tests. |
| `/teach` | Teacher | Teaches you a skill or a codebase with lessons and exercises at your level. |
| `/perf` | Performance detective | Profiles slow code, fixes measured bottlenecks and compares performance before and after. |
| `/migrate` | Migration planner | Plans and carries out a package or framework upgrade in small, checked steps. |
| `/reviewer` | Reviewer | Reviews someone else's pull request: explains the change, finds problems and drafts comments. It doesn't post anything. |
| `/incident` | Incident | For production problems: stabilize first, find the cause from logs and recent changes, end with a postmortem. |
| `/hackerman` | Hackerman | Reviews your code for security vulnerabilities, tests potential exploits and helps fix them. |
| `/docs` | Docs writer | Writes or updates documentation and checks commands and examples against the code. |
| `/design` | Designer | Interviews you about a new site or app with color, font and rounding pickers, and writes a design specification. |

Other commands include `/new`, `/plain`, `/compact`, `/export`, `/model`, `/skill`, `/create-skill` and `/install-mcp`. Type `/help` for the full list.

## Install

### Windows installer

Download `BasedCode-Setup-<version>.exe` from the [latest release](https://github.com/Naamloos/BasedCode/releases/latest) and run it. The installer includes its own Node.js and NW.js runtime, so you don't need anything else installed apart from a model provider. It installs to `Program Files` and needs administrator rights.

The installed app checks GitHub for new releases (source checkouts don't). When one is available, **Settings → Info → Check for updates** downloads and runs the new installer.

### From source (Windows and Linux)

You need **Node.js 24 or newer**. macOS is not supported yet.

```bash
git clone https://github.com/Naamloos/BasedCode.git
cd BasedCode
npm install
npx camoufox-js fetch   # optional: browser for the agent's browser tools
npm run build
npm start
```

The first start downloads the NW.js runtime, then the BasedCode window opens.

> **npm 11 and install scripts:** recent npm versions may skip install scripts and print `npm warn install-scripts`. BasedCode needs them for `node-pty` and `nw`. If the app fails to start after a fresh install, run `npm install-scripts ls`, approve the listed packages with `npm install-scripts approve <pkg>`, and run `npm install` again.

BasedCode stores chats and settings in `%LOCALAPPDATA%\BasedCode` on Windows and `~/.local/share/basedcode` on Linux. Set `BASEDCODE_DATA_DIR` to use another folder.

### Connect a provider

Log in once on the command line; BasedCode reuses that login and stores no credentials of its own for CLI providers.

| Provider | What to do |
| --- | --- |
| Claude Code | `claude login` |
| Codex | `codex login` |
| Antigravity | Install `agy` and sign in (run `agy`, or use the sign-in button in BasedCode settings) |
| Ollama | `ollama serve`, then set the endpoint in BasedCode settings |
| LM Studio | Start the local server, then set the endpoint in BasedCode settings |

## First steps

Ask BasedCode to explain a project you know, so you can judge the answer.

1. Open a folder with one of your own projects.
2. Choose a provider and model.
3. Type `/dig` and press Enter. This starts a chat in archaeology mode, which only reads code.
4. Ask something like:

   ```
   Why is [a file or function you know] implemented this way? Use the git history.
   ```

Watch the tool cards as the agent searches files and reads the history. Then try a normal chat with a small change, for example "add a test for X", and look at the diff and approval cards before you accept anything.

## Limitations

- **No sandbox yet.** Commands run with your own user permissions. That is why every terminal command needs approval.
- MCP and language servers run as normal child processes.
- Reverting a prompt restores files only. It does not undo Git commits, branches, stashes or the index. Checkpoints skip dependency folders, links and very large files.
- Commits made by the app do not run Git hooks.
- Not supported yet: macOS, a Linux installer, editing code in the built-in file viewer, and subagents.

## Releases

Download Windows installers from [GitHub Releases](https://github.com/Naamloos/BasedCode/releases).

To release, bump `version` in `package.json` on `master`. The [release workflow](.github/workflows/release.yml) tags `v<version>`, builds the installer on a Windows runner and publishes the release. You can also trigger it by pushing a `v*` tag or running the workflow.

## Contributing

```bash
npm run dev          # dev mode with hot reload (Vite on port 5317)
npm run typecheck
npm run lint
npm test
npm run package:win  # Windows installer, after npm run build
```

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` and so on). The commit-msg hook runs commitlint. See [AGENTS.md](AGENTS.md) for the project layout and conventions.

## License

[GNU AGPLv3](LICENSE) © 2026 Ryan de Jonge
