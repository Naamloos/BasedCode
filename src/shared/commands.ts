import { guidedModes } from './chatModes.js';

export interface SlashCommandParam {
  name: string;
  description: string;
  optional?: boolean;
  /** Takes the rest of the line, spaces included. */
  rest?: boolean;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  params?: readonly SlashCommandParam[];
  example?: string;
}

export const slashCommands = [
  { name: "help", description: "Show available commands" },
  { name: "new", description: "Start a new chat" },
  { name: "plain", description: "Start a new plain chat" },
  ...guidedModes.map((mode) => ({ name: mode.command, description: `Start a new chat in ${mode.label.toLowerCase()}` }) as const),
  { name: "compact", description: "Compact this conversation" },
  {
    name: "rename",
    description: "Rename this chat",
    params: [
      {
        name: "title",
        description: "New chat title. Leave empty to edit the title in the sidebar.",
        optional: true,
        rest: true,
      },
    ],
    example: "/rename Fix login redirect",
  },
  { name: "pin", description: "Pin or unpin this chat" },
  { name: "archive", description: "Archive or unarchive this chat" },
  { name: "export", description: "Export this chat as Markdown" },
  { name: "find", description: "Find in chat" },
  { name: "stop", description: "Stop the running agent" },
  { name: "model", description: "Choose a model" },
  { name: "terminal", description: "Toggle the terminal" },
  { name: "settings", description: "Open app settings" },
  { name: "keybindings", description: "Edit keyboard shortcuts" },
  { name: "usage", description: "Show usage and storage" },
  { name: "tools", description: "Manage BasedCode tools" },
  { name: "skills", description: "List workspace skills" },
  {
    name: "skill",
    description: "Activate a workspace skill",
    params: [
      { name: "name", description: "Skill name (workspace or global), e.g. code-review." },
      {
        name: "task",
        description: "What the skill should do. Defaults to explaining the skill.",
        optional: true,
        rest: true,
      },
    ],
    example: "/skill code-review check the auth changes",
  },
  {
    name: "create-skill",
    description: "Create a reusable workspace skill",
    params: [
      {
        name: "description",
        description: "What the skill should do and when to use it.",
        rest: true,
      },
    ],
    example: "/create-skill review SQL migrations for unsafe locks",
  },
  { name: "mcp", description: "List configured MCP servers" },
  {
    name: "install-mcp",
    description: "Install an MCP server",
    params: [
      {
        name: "package@version",
        description: "npm package pinned to an exact version.",
      },
      { name: "bin", description: "Executable the package provides (its package.json \"bin\" entry)." },
    ],
    example: "/install-mcp example-mcp-server@1.2.3 example-mcp-server",
  },
] as const satisfies readonly SlashCommandInfo[];

/** "<name> [task]": required params in angle brackets, optional ones in square brackets. */
export function slashCommandSignature(command: SlashCommandInfo) {
  return (command.params ?? [])
    .map((param) => (param.optional ? `[${param.name}]` : `<${param.name}>`))
    .join(" ");
}

/** Usage text for errors, e.g. "Usage: /skill <name> [task]". */
export function slashCommandUsage(name: string) {
  const command = slashCommands.find((item) => item.name === name);
  if (!command) return `Usage: /${name}`;
  const signature = slashCommandSignature(command);
  return `Usage: /${name}${signature ? ` ${signature}` : ""}`;
}

export function parseSlashCommand(input: string) {
  const match = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match) return undefined;
  const command = slashCommands.find((item) => item.name === match[1]);
  return command
    ? { name: command.name, args: (match[2] ?? "").trim() }
    : undefined;
}
