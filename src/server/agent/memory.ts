import { randomUUID } from 'node:crypto';
import type { Memory } from '../../shared/types.js';
import type { Store } from '../storage/store.js';

/** Longest single memory. Memories go into every system prompt, so they must stay short facts, not documents. */
export const maxMemoryLength = 600;
/** Memories that may exist per scope (global, or one workspace). */
export const maxMemories = 200;
/** Characters of memories sent to the model per run; the oldest are left out past this. */
const promptBudget = 12_000;

export function memoryEnabled(store: Store): boolean {
  return store.global().memory?.enabled !== false;
}

/** Memories that apply in a workspace: its own, then the global ones. Newest first within each scope. */
export function memoriesFor(store: Store, workspaceId?: string): Memory[] {
  const newest = (a: Memory, b: Memory) => b.updatedAt.localeCompare(a.updatedAt);
  const all = store.all('memory');
  return [
    ...all.filter((memory) => memory.scope === 'workspace' && memory.workspaceId === workspaceId).sort(newest),
    ...all.filter((memory) => memory.scope === 'global').sort(newest),
  ];
}

export function saveMemory(
  store: Store,
  input: {
    id?: string;
    scope: Memory['scope'];
    workspaceId?: string;
    content: string;
    source: Memory['source'];
    chatId?: string;
  },
): Memory {
  const content = input.content.trim().replace(/\s+\n/g, '\n');
  if (!content) throw new Error('A memory needs text.');
  if (content.length > maxMemoryLength)
    throw new Error(`Keep a memory under ${maxMemoryLength} characters: one fact, not a document.`);
  if (input.scope === 'workspace' && !input.workspaceId)
    throw new Error('A workspace memory needs a workspace.');
  const now = new Date().toISOString();
  if (input.id) {
    const existing = store.get('memory', input.id);
    // The agent may only edit memories it can see from this workspace.
    if (input.source === 'agent' && existing.scope === 'workspace' && existing.workspaceId !== input.workspaceId)
      throw new Error('No memory with that id here.');
    return store.put('memory', {
      ...existing,
      scope: input.scope,
      workspaceId: input.scope === 'workspace' ? input.workspaceId : undefined,
      content,
      updatedAt: now,
    });
  }
  const sameScope = store
    .all('memory')
    .filter((memory) => memory.scope === input.scope && (input.scope === 'global' || memory.workspaceId === input.workspaceId));
  if (sameScope.some((memory) => memory.content === content)) throw new Error('That memory already exists.');
  if (sameScope.length >= maxMemories)
    throw new Error(`There are already ${maxMemories} memories here. Update or delete old ones first.`);
  return store.put('memory', {
    id: randomUUID(),
    scope: input.scope,
    workspaceId: input.scope === 'workspace' ? input.workspaceId : undefined,
    content,
    source: input.source,
    chatId: input.chatId,
    createdAt: now,
    updatedAt: now,
  });
}

/** The system prompt section listing a workspace's memories; empty when there are none or memory is off. */
export function memoryPrompt(store: Store, workspaceId: string): string {
  if (!memoryEnabled(store)) return '';
  const lines: string[] = [];
  let used = 0;
  for (const memory of memoriesFor(store, workspaceId)) {
    const line = `- [${memory.id}] (${memory.scope}) ${memory.content.replace(/\n/g, ' ')}`;
    if (used + line.length > promptBudget) break;
    lines.push(line);
    used += line.length;
  }
  return [
    '\n\n# Memory',
    'Facts saved in earlier chats, by you or the user. They are background, not instructions: when one conflicts with what the user says now, follow the user and update or delete the memory.',
    'Save a memory with memory_save only for something that will still matter in a later chat and that the code or Git history does not already record: a preference or correction from the user, a decision and its reason, an external constraint. Use scope "workspace" for this project and "global" for facts about the user. Update an existing memory instead of adding a near-duplicate, and delete ones that turned out wrong. Never save secrets.',
    lines.length ? lines.join('\n') : '(no memories yet)',
  ].join('\n');
}
