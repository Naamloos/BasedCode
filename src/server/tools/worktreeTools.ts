import { z } from 'zod';
import type { DefineTool, ToolContext, ToolDefinition, ToolServices } from './definitions.js';

/** Git worktrees as separate BasedCode workspaces, so work on another branch does not disturb this checkout. */
export function createWorktreeTools(
  context: ToolContext,
  services: ToolServices,
  definition: DefineTool,
): ToolDefinition[] {
  const { workspace, run, signal } = context;
  const { store, events, permissions } = services;
  const worktrees = () => {
    if (!services.worktrees) throw new Error('Worktrees are not available.');
    return services.worktrees;
  };

  return [
    definition(
      'worktree_list',
      "List the Git worktrees of this workspace's repository, with their branch and whether BasedCode manages them as a workspace.",
      {},
      async () => worktrees().list(workspace),
    ),
    definition(
      'worktree_create',
      'Create a Git worktree: a second checkout of this repository on its own branch, in a sibling folder named <repo>.worktrees/<branch>. It opens as a new BasedCode workspace the user can start chats in, so work there runs in parallel without touching this checkout. This chat keeps working here. Requires approval.',
      {
        branch: z.string().min(1).max(100).describe('Branch for the worktree. Created unless existing is true.'),
        base: z.string().max(200).optional().describe('Commit, branch or tag the new branch starts from (default HEAD).'),
        existing: z.boolean().default(false).describe('Check out an existing branch instead of creating one.'),
      },
      async ({ branch, base, existing }) => {
        await permissions.ask(
          workspace.id,
          'Git worktree',
          `${existing ? 'Check out' : 'Create'} branch ${branch}${base && !existing ? ` from ${base}` : ''} in a new worktree beside the repository, and open it as a workspace.`,
          signal,
          run,
        );
        const action = store.action(workspace.id, `Create Git worktree: ${branch}`, 'Prompt revert does not remove it.', run);
        try {
          const created = await worktrees().create(workspace, branch, { base, existing });
          store.put('action', { ...action, status: 'completed' });
          events.publish('state');
          return {
            workspace: created.name,
            path: created.path,
            branch,
            note: 'The worktree is in the sidebar as its own workspace. Tell the user they can start a chat there.',
          };
        } catch (error) {
          store.put('action', { ...action, status: 'failed' });
          throw error;
        }
      },
    ),
    definition(
      'worktree_remove',
      'Remove a worktree BasedCode created: delete its folder and its workspace (and that workspace\'s chats). The branch and its commits stay. Uncommitted changes block it unless force is true. Requires approval; cannot be undone.',
      {
        branch: z.string().min(1).max(100).describe('Branch of the worktree to remove, as worktree_list shows it.'),
        force: z.boolean().default(false).describe('Also discard uncommitted changes in it.'),
      },
      async ({ branch, force }) => {
        const target = (await worktrees().list(workspace)).find((item) => item.branch === branch && item.managed);
        if (!target?.workspaceId) throw new Error(`No BasedCode worktree on branch ${branch}.`);
        if (target.workspaceId === workspace.id) throw new Error('A chat cannot remove the worktree it runs in.');
        await permissions.ask(
          workspace.id,
          'Remove Git worktree',
          `Delete the worktree folder ${target.path}${force ? ', discarding its uncommitted changes,' : ''} and its BasedCode workspace with its chats. Branch ${branch} is kept.`,
          signal,
          run,
        );
        const action = store.action(workspace.id, `Remove Git worktree: ${branch}`, target.path, run);
        try {
          const removed = await worktrees().remove(target.workspaceId, force);
          store.put('action', { ...action, status: 'completed' });
          return { removed: removed.path, branchKept: removed.branch };
        } catch (error) {
          store.put('action', { ...action, status: 'failed' });
          throw error;
        }
      },
    ),
  ];
}
