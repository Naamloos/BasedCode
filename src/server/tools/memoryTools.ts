import { z } from 'zod';
import { maxMemoryLength, memoryEnabled, saveMemory } from '../agent/memory.js';
import type { DefineTool, ToolContext, ToolDefinition, ToolServices } from './definitions.js';

/** Save, update and delete the memories listed in the system prompt. Absent while the user has memory turned off. */
export function createMemoryTools(
  context: ToolContext,
  services: Pick<ToolServices, 'store' | 'events'>,
  definition: DefineTool,
): ToolDefinition[] {
  const { store, events } = services;
  const { workspace, run } = context;
  // The settings catalog lists every tool, so only hide them from real runs.
  if (workspace.id && !memoryEnabled(store)) return [];
  return [
    definition(
      'memory_save',
      'Save a short fact for later chats, or update one (give its id from the Memory section of your instructions). Use it for user preferences and corrections, decisions with their reason, and constraints the code does not show. One fact per memory. Never store secrets.',
      {
        content: z.string().trim().min(1).max(maxMemoryLength).describe('The fact, in one or two sentences.'),
        scope: z
          .enum(['workspace', 'global'])
          .default('workspace')
          .describe('workspace: only this project. global: every workspace (facts about the user).'),
        id: z.string().optional().describe('Id of an existing memory to replace.'),
      },
      async ({ content, scope, id }) => {
        const memory = saveMemory(store, {
          id,
          scope,
          workspaceId: workspace.id,
          content,
          source: 'agent',
          chatId: run.chatId,
        });
        events.publish('state');
        return { saved: memory.id, scope: memory.scope };
      },
    ),
    definition(
      'memory_delete',
      'Delete a memory that is wrong or no longer useful, by its id from the Memory section of your instructions.',
      { id: z.string().min(1) },
      async ({ id }) => {
        const memory = store.all('memory').find((item) => item.id === id);
        if (!memory || (memory.scope === 'workspace' && memory.workspaceId !== workspace.id))
          throw new Error('No memory with that id here.');
        store.remove('memory', id);
        events.publish('state');
        return { deleted: id };
      },
    ),
  ];
}
