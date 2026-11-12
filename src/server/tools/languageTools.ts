import { z } from 'zod';
import { languageOperations } from '../../shared/types.js';
import {
  type DefineTool,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
} from './definitions.js';
import { createWorkspaceEditor } from './workspaceEdits.js';

export function createLanguageTools(
  context: ToolContext,
  services: ToolServices,
  definition: DefineTool,
  changed: (path: string) => Promise<object>,
): ToolDefinition[] {
  const { workspace, run, signal } = context;
  const { languages, events } = services;
  const applyWorkspaceEdits = createWorkspaceEditor(context, changed, (path) =>
    events.publish('files-changed', { path }, workspace.id, run.id),
  );

  return [
    definition(
      'language_servers',
      'Discover configured language servers and whether they are installed. Optionally set up a missing default server by its serverId; installation requires approval.',
      {
        serverId: z.string().optional(),
      },
      async ({ serverId }) =>
        serverId
          ? languages.setup(workspace, serverId, signal, run)
          : languages.discoverServers(workspace),
    ),
    definition(
      'language_query',
      'Query LSP diagnostics, navigation, symbols, completions, signature help, type definitions, implementations or document highlights. Positions use zero-based lines and UTF-16 character offsets. Missing default servers are set up with approval.',
      {
        path: z.string(),
        operation: z.enum(languageOperations),
        line: z.number().int().min(0).default(0),
        character: z.number().int().min(0).default(0),
      },
      async ({ path, operation, line, character }) =>
        languages.query(workspace, path, operation, line, character, signal, run),
    ),
    definition(
      'language_rename',
      'Rename the symbol at a position across the workspace using the language server. Positions are zero-based (line, UTF-16 character), pointing anywhere inside the symbol. Set dryRun to preview affected files. Applies all edits or none.',
      {
        path: z.string(),
        line: z.number().int().min(0),
        character: z.number().int().min(0),
        newName: z.string().min(1).max(500),
        dryRun: z.boolean().default(false),
      },
      async ({ path, line, character, newName, dryRun }) =>
        applyWorkspaceEdits(
          [await languages.rename(workspace, path, line, character, newName, signal, run)],
          dryRun,
        ),
    ),
    definition(
      'language_code_actions',
      'List language-server code actions (quick fixes, refactors, organize imports) for a range, or apply one by its exact title. Zero-based positions; the end defaults to the start. List first, then apply. Applies all edits or none.',
      {
        path: z.string(),
        startLine: z.number().int().min(0),
        startCharacter: z.number().int().min(0).default(0),
        endLine: z.number().int().min(0).optional().describe('Defaults to startLine.'),
        endCharacter: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Defaults to startCharacter on the same line, or 0 when endLine is given.'),
        only: z
          .array(z.string())
          .optional()
          .describe('Kinds to request, e.g. ["quickfix"] or ["source.organizeImports"].'),
        apply: z
          .string()
          .min(1)
          .optional()
          .describe('Exact title of the action to apply. Omit to list actions.'),
        dryRun: z
          .boolean()
          .default(false)
          .describe('With apply: return affected files without writing.'),
      },
      async ({ path, startLine, startCharacter, endLine, endCharacter, only, apply, dryRun }) => {
        const range = {
          start: { line: startLine, character: startCharacter },
          end: {
            line: endLine ?? startLine,
            character: endCharacter ?? (endLine === undefined ? startCharacter : 0),
          },
        };
        if (!apply)
          return {
            actions: await languages.codeActions(workspace, path, range, only, signal, run),
          };
        return {
          action: apply,
          ...(await applyWorkspaceEdits(
            await languages.codeActionEdits(workspace, path, range, apply, only, signal, run),
            dryRun,
          )),
        };
      },
    ),
  ];
}
