import { z } from 'zod';
import { inputSchema, type ToolDefinition } from './definitions.js';

/**
 * Tools the model rarely needs in a given run. Their names stay visible in a short catalog; their schemas, which
 * are most of what a tool definition costs on every model request, are only sent when a group is asked for.
 */
export const toolGroups: Record<string, { about: string; tools: string[] }> = {
  browser: {
    about: 'drive a real browser to test or inspect a web page',
    tools: [
      'browser_navigate',
      'browser_inspect',
      'browser_click',
      'browser_fill',
      'browser_interact',
      'browser_wait',
      'browser_screenshot',
      'browser_logs',
      'browser_control',
    ],
  },
  computer: {
    about: 'see and control the Windows desktop: screenshot, mouse, keyboard; for native apps the browser tools cannot reach',
    tools: [
      'computer_screenshot',
      'computer_click',
      'computer_move',
      'computer_drag',
      'computer_scroll',
      'computer_type',
      'computer_key',
    ],
  },
  visuals: {
    about: 'show the user an interactive HTML preview, chart, Mermaid diagram or image in the chat',
    tools: ['render_ui', 'render_chart', 'render_diagram', 'show_image'],
  },
  design: {
    about: 'ask the user with a color, font, corner-radius or slider picker, a choice with a live hover preview, or a custom HTML question',
    tools: ['query_color', 'query_font', 'query_radius', 'query_slider', 'query_preview', 'query_ui'],
  },
  git_write: {
    about: 'branch, stash, stage and commit; only when the user asks',
    tools: ['git_branch', 'git_stash', 'git_stage', 'git_commit'],
  },
  refactor: {
    about: 'language-server rename, quick fixes and organize imports; set up language servers',
    tools: ['language_rename', 'language_code_actions', 'language_servers'],
  },
  mcp: {
    about: 'MCP integrations: list servers and their tools, call them, read resources, install a server',
    tools: ['list_mcp', 'call_mcp', 'read_mcp_resource', 'get_mcp_prompt', 'install_server'],
  },
  skills: {
    about: 'workspace and global skills: list, activate, create',
    tools: ['list_skills', 'activate_skill', 'create_skill'],
  },
  files_extra: {
    about: 'images, PDF/Office documents, file metadata, creating and deleting directories',
    tools: ['view_image', 'extract_document', 'file_info', 'make_directory', 'delete_directory'],
  },
  reviews: {
    about: "read other models' second opinions on this chat",
    tools: ['second_opinions'],
  },
};

/** A tool's arguments as compact JSON Schema, without the keys that only matter to validators. */
function schemaText(definition: ToolDefinition): string {
  try {
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== '$schema' && key !== 'additionalProperties')
          .map(([key, item]) => [key, strip(item)]),
      );
    };
    return JSON.stringify(strip(z.toJSONSchema(inputSchema(definition.shape))));
  } catch {
    return JSON.stringify(Object.keys(definition.shape));
  }
}

const describe = (definition: ToolDefinition) =>
  `## ${definition.name}\n${definition.description}\nargs: ${schemaText(definition)}`;

export interface OfferedTools {
  /** Definitions sent to the model: the everyday tools plus load_tools and call_tool. */
  offered: ToolDefinition[];
  /** System prompt section naming the deferred groups; empty when nothing is deferred. */
  catalog: string;
}

/**
 * Splits a run's tools into those sent in full and those reached through `call_tool`. `keep` names tools that stay
 * loaded whatever their group (a guided mode built around them, say). Deferred tools run through their own
 * definitions, so approvals, budgets, the secret guard and the chat's tool cards behave exactly as if called directly.
 */
export function deferTools(definitions: ToolDefinition[], keep: (name: string) => boolean): OfferedTools {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const groups = Object.entries(toolGroups)
    .map(([name, group]) => ({
      name,
      about: group.about,
      tools: group.tools.flatMap((tool) => {
        const definition = byName.get(tool);
        return definition && !keep(tool) ? [definition] : [];
      }),
    }))
    .filter((group) => group.tools.length);
  // Two extra definitions only pay for themselves when they replace more than a couple of tools.
  const deferred = new Map(groups.flatMap((group) => group.tools).map((tool) => [tool.name, tool]));
  if (deferred.size < 4) return { offered: definitions, catalog: '' };

  const groupNames = groups.map((group) => group.name) as [string, ...string[]];
  const loadShape = {
    group: z.enum(groupNames),
  };
  const callShape = {
    name: z.string(),
    // Not z.record: its JSON Schema carries propertyNames, which makes Claude Code drop every BasedCode tool.
    args: z.object({}).catchall(z.unknown()).default({}),
  };
  const load: ToolDefinition = {
    name: 'load_tools',
    description:
      'Get the descriptions and arguments of one group of extra tools (see MORE TOOLS in your instructions). Run them with call_tool.',
    shape: loadShape,
    execute: async (input) => {
      const { group } = z.object(loadShape).parse(input);
      return groups
        .find((item) => item.name === group)!
        .tools.map(describe)
        .join('\n\n');
    },
  };
  const call: ToolDefinition = {
    name: 'call_tool',
    description:
      'Run an extra tool by name with its arguments as an object. Call load_tools for its group first unless you already have its arguments.',
    shape: callShape,
    execute: async (input) => {
      const { name, args } = z.object(callShape).parse(input);
      const definition = deferred.get(name);
      if (!definition) {
        if (byName.has(name))
          throw new Error(`${name} is a regular tool: call it directly, not through call_tool.`);
        throw new Error(`No extra tool named "${name}". Available: ${[...deferred.keys()].join(', ')}.`);
      }
      try {
        return await definition.execute(args);
      } catch (error) {
        // A wrong guess at the arguments gets the schema back, so the next call can be right without a load.
        if (error instanceof z.ZodError)
          throw new Error(
            `Invalid arguments for ${name}: ${z.prettifyError(error)}\n${describe(definition)}`,
            { cause: error },
          );
        throw error;
      }
    },
  };

  const catalog = [
    'MORE TOOLS',
    'These exist but their arguments are not loaded, to keep context small. load_tools(group) returns them; then call_tool(name, args) runs one. They are BasedCode tools like any other.',
    ...groups.map(
      (group) =>
        `- ${group.name} (${group.about}): ${group.tools.map((tool) => tool.name).join(', ')}`,
    ),
  ].join('\n');
  return {
    offered: [...definitions.filter((definition) => !deferred.has(definition.name)), load, call],
    catalog,
  };
}
