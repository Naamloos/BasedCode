import { z } from 'zod';
import { Languages } from '../integrations/languages.js';
import { McpConnections } from '../integrations/mcp.js';
import { Processes } from '../runtime/processes.js';
import { Events } from '../storage/events.js';
import { Store } from '../storage/store.js';
import { Permissions } from '../workspace/permissions.js';
import {
  isImageResult,
  isModelView,
  type ToolContext,
  type ToolDefinition,
} from './definitions.js';
import { createFileNotifier } from './fileChanges.js';
import { createFileTools } from './fileTools.js';
import { createBrowserTools } from './browserTools.js';
import { createComputerTools } from './computerTools.js';
import { createGitTools } from './gitTools.js';
import { createIntegrationTools } from './integrationTools.js';
import { createLanguageTools } from './languageTools.js';
import { createTerminalTools } from './terminalTools.js';
import { createSkillTools } from './skillTools.js';
import { createVisualTools } from './visualTools.js';
import { createQueryTools } from './queryTools.js';
import { createChatTools } from './chatTools.js';
export {
  fileChangingTools,
  readOnlyTools,
  inputSchema,
  isImageResult,
  resultImages,
  type ImageResult,
  type ToolContext,
  type ToolDefinition,
} from './definitions.js';

/** Characters of one tool result passed to the model. Tools page their own output well below this; it is the backstop. */
const toolResultLimit = 24_000;

const cutNote = (length: number) =>
  `[${(length - toolResultLimit).toLocaleString()} more characters cut. Narrow the request (paths, lines, filters) for the rest.]`;

export class CodingTools {
  constructor(
    private readonly store: Store,
    private readonly events: Events,
    private readonly permissions: Permissions,
    private readonly processes: Processes,
    private readonly languages: Languages,
    private readonly mcp: McpConnections,
    private readonly managedDirectory: string,
    private readonly attachmentDirectory: string,
  ) {}

  /** Tools offered to the model: everything except those the user disabled in app settings. */
  definitions(context: ToolContext): ToolDefinition[] {
    const disabled = new Set(this.store.global().disabledTools ?? []);
    return this.allDefinitions(context).filter((item) => !disabled.has(item.name));
  }

  /** Every tool's name and description, for the settings page. Handlers are never executed here. */
  catalog(): { name: string; description: string }[] {
    const context = {
      workspace: { path: '' },
      run: {},
      signal: new AbortController().signal,
    } as unknown as ToolContext;
    return this.allDefinitions(context).map(({ name, description }) => ({ name, description }));
  }

  private allDefinitions(context: ToolContext): ToolDefinition[] {
    const { run, signal } = context;
    const definition = <S extends z.ZodRawShape>(
      name: string,
      description: string,
      shape: S,
      handler: (
        args: z.infer<z.ZodObject<S>>,
        progress: (result: unknown) => void,
      ) => Promise<unknown>,
    ): ToolDefinition => ({
      name,
      description,
      shape,
      execute: async (input) => {
        signal.throwIfAborted();
        while (this.processes.hasTakeover(run.id)) {
          signal.throwIfAborted();
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        const args = z.object(shape).strict().parse(input);
        const message = this.store.message(run.chatId, run.id, 'tool', name, {
          tool: { name, args, status: 'running' },
        });
        this.events.publish('state');
        try {
          await context.beforeTool?.(name, message.id);
          const result = await handler(args, (result) => {
            this.store.put('message', {
              ...message,
              metadata: { tool: { name, args, status: 'running', result } },
            });
            this.events.publish('state');
          });
          if (isImageResult(result)) {
            // The chat keeps the image's description; the pixels only go to the model.
            const stored = {
              path: result.path,
              mediaType: result.mediaType,
              bytes: result.bytes,
              images: 1 + (result.moreImages?.length ?? 0),
              ...(result.text ? { text: result.text.slice(0, toolResultLimit) } : {}),
            };
            this.store.put('message', {
              ...message,
              metadata: { tool: { name, args, status: 'completed', result: stored } },
            });
            this.events.publish('state');
            return result;
          }
          // Text results go to the model as they are: no JSON quoting, which costs tokens on code and paths.
          const view = isModelView(result) ? result : undefined;
          const value: unknown = view ? view.text : result;
          let visible: unknown = value;
          // Big results are cut: every later model step resends them. Narrower reads or searches get the rest.
          if (typeof value === 'string') {
            if (value.length > toolResultLimit)
              visible = `${value.slice(0, toolResultLimit)}
${cutNote(value.length)}`;
          } else {
            const encoded = JSON.stringify(value) ?? 'null';
            if (encoded.length > toolResultLimit)
              visible = {
                truncated: true,
                note: cutNote(encoded.length),
                summary: encoded.slice(0, toolResultLimit),
              };
          }
          this.store.put('message', {
            ...message,
            metadata: {
              tool: {
                name,
                args,
                status: 'completed',
                result: view ? view.stored : name === 'call_mcp' ? result : visible,
              },
            },
          });
          this.events.publish('state');
          return visible;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.store.put('message', {
            ...message,
            metadata: { tool: { name, args, status: 'failed', error: detail } },
          });
          this.events.publish('state');
          throw error;
        }
      },
    });

    const changed = createFileNotifier(context, this.events, this.languages);

    const services = {
      store: this.store,
      events: this.events,
      permissions: this.permissions,
      processes: this.processes,
      languages: this.languages,
      mcp: this.mcp,
      managedDirectory: this.managedDirectory,
      attachmentDirectory: this.attachmentDirectory,
    };

    const fileTools = createFileTools(context, services, definition);
    const write = fileTools.find((tool) => tool.name === 'write_file')!;
    return [
      ...createSkillTools(context, definition, write, services.permissions),
      ...createVisualTools(context, services, definition),
      ...createQueryTools(context, definition),
      ...createChatTools(context, services, definition),
      ...fileTools,
      ...createBrowserTools(context, services, definition),
      // The desktop helper drives user32 through Windows PowerShell; other platforms get no computer tools yet.
      ...(process.platform === 'win32' ? createComputerTools(context, services, definition) : []),
      ...createTerminalTools(context, services, definition),
      ...createGitTools(context, services, definition),
      ...createLanguageTools(context, services, definition, changed),
      ...createIntegrationTools(context, services, definition),
    ];
  }
}
