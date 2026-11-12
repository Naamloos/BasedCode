import { z } from 'zod';
import type { Run, Workspace } from '../../shared/types.js';
import type { Languages } from '../integrations/languages.js';
import type { McpConnections } from '../integrations/mcp.js';
import type { Processes } from '../runtime/processes.js';
import type { Events } from '../storage/events.js';
import type { Store } from '../storage/store.js';
import type { Permissions } from '../workspace/permissions.js';

/** A tool result carrying an image. Providers that accept images in tool results get `data` as an image; others get the text. */
export interface ImageResult {
  path: string;
  mediaType: string;
  bytes: number;
  /** Base64. Never stored in the chat; only sent to the model. */
  data: string;
  imageResult: true;
  /** Text to send alongside the image(s), such as an extracted document. */
  text?: string;
  /** Further images after `data`, e.g. pictures embedded in a document. */
  moreImages?: { mediaType: string; data: string }[];
}

/** Every image of a result, first one included. */
export function resultImages(result: ImageResult): { mediaType: string; data: string }[] {
  return [{ mediaType: result.mediaType, data: result.data }, ...(result.moreImages ?? [])];
}

export function isImageResult(value: unknown): value is ImageResult {
  return typeof value === 'object' && value !== null && (value as ImageResult).imageResult === true;
}

/** A result whose model-facing text differs from what the chat stores and shows (terminal cards, check lists). */
export interface ModelView {
  modelView: true;
  stored: unknown;
  text: string;
}

export const forModel = (stored: unknown, text: string): ModelView => ({
  modelView: true,
  stored,
  text,
});

export function isModelView(value: unknown): value is ModelView {
  return typeof value === 'object' && value !== null && (value as ModelView).modelView === true;
}

export interface ToolDefinition {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Provider-facing input schema. Some MCP bridges turn `.default()` fields into required ("nonoptional") ones,
 * so defaulted fields are exposed as plain optionals here. Defaults are still applied by the strict parse in
 * `execute`.
 */
export function inputSchema(shape: z.ZodRawShape): z.ZodObject {
  const fields: Record<string, z.ZodRawShape[string]> = Object.create(null);

  for (const [key, field] of Object.entries(shape)) {
    if (!(field instanceof z.ZodDefault)) {
      fields[key] = field;
      continue;
    }

    const optional = (field.unwrap() as z.ZodType).optional();
    fields[key] = field.description ? optional.describe(field.description) : optional;
  }

  return z.object(fields);
}

export interface ToolContext {
  workspace: Workspace;
  run: Run;
  signal: AbortSignal;
  /** Called after a tool call's chat message exists and before it runs; used for rewind snapshots. */
  beforeTool?: (name: string, messageId: string) => Promise<void>;
}

export { fileChangingTools } from '../../shared/types.js';

/** Tools a read-only reviewer may use: they look at the workspace but never change it or reach out. */
export const readOnlyTools = new Set([
  'file_info',
  'list_files',
  'read_file',
  'read_files',
  'search',
  'find_files',
  'file_outline',
  'view_image',
  'extract_document',
  'language_servers',
  'language_query',
  'update_plan',
]);

/** Services shared by the concrete tool groups; each group uses its own subset. */
export interface ToolServices {
  store: Store;
  events: Events;
  permissions: Permissions;
  processes: Processes;
  languages: Languages;
  mcp: McpConnections;
  managedDirectory: string;
  attachmentDirectory: string;
}

/** Registration keeps argument validation and execution auditing identical for every tool. */
export type DefineTool = <S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  handler: (args: z.infer<z.ZodObject<S>>, progress: (result: unknown) => void) => Promise<unknown>,
) => ToolDefinition;
