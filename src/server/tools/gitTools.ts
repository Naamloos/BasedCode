import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  gitBranch,
  gitCommit,
  gitRead,
  gitStage,
  gitStaged,
  gitStash,
} from '../workspace/workspace.js';
import {
  type DefineTool,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
} from './definitions.js';

export function createGitTools(
  context: ToolContext,
  services: ToolServices,
  definition: DefineTool,
): ToolDefinition[] {
  const { workspace, run, signal } = context;
  const { store, events, permissions, managedDirectory } = services;

  return [
    definition(
      'git',
      'Read Git state: status, diff (working tree vs HEAD incl. untracked, or staged), log, show (a commit with stat and patch) or blame. Narrow diff/show with path: large output is cut.',
      {
        operation: z.enum(['status', 'diff', 'log', 'show', 'blame']),
        path: z.string().optional().describe('File or directory to limit to. Required for blame.'),
        revision: z.string().optional().describe('Commit-ish for show/blame (default HEAD).'),
        count: z.number().int().min(1).max(200).optional().describe('Log entries (default 12).'),
        staged: z.boolean().optional().describe('diff: only staged changes.'),
        startLine: z.number().int().min(1).optional().describe('blame: first line, 1-based.'),
        endLine: z.number().int().min(1).optional().describe('blame: last line, inclusive.'),
      },
      async ({ operation, ...options }) =>
        (await gitRead(workspace, operation, options)).trimEnd() || '(no output)',
    ),
    definition(
      'git_branch',
      'Create a local branch, or switch to an existing one (create: false). Requires approval.',
      {
        name: z.string().min(1).max(100),
        create: z.boolean().default(true),
      },
      async ({ name, create }) => {
        await permissions.ask(
          workspace.id,
          'Git branch',
          `${create ? 'Create' : 'Switch to'} local branch ${name}.`,
          signal,
          run,
        );
        const action = store.action(
          workspace.id,
          `${create ? 'Create' : 'Switch'} Git branch: ${name}`,
          '',
          run,
        );
        try {
          const status = await gitBranch(workspace, name, create);
          store.put('action', { ...action, status: 'completed' });
          events.publish('files-changed', { path: '.' }, workspace.id, run.id);
          return { status };
        } catch (error) {
          store.put('action', { ...action, status: 'failed' });
          throw error;
        }
      },
    ),
    definition(
      'git_stash',
      'Stash tracked and untracked changes (push) or apply the latest stash (pop). Requires approval; not undone by prompt revert.',
      {
        operation: z.enum(['push', 'pop']),
      },
      async ({ operation }) => {
        await permissions.ask(
          workspace.id,
          'Git stash',
          operation === 'push'
            ? 'Save tracked and untracked working tree changes into a new stash entry.'
            : 'Apply and remove the latest stash entry. Conflicts may leave changes in the workspace.',
          signal,
          run,
        );
        const action = store.action(
          workspace.id,
          `Git stash ${operation}`,
          'Prompt revert does not undo stash changes.',
          run,
        );
        try {
          const status = await gitStash(workspace, operation);
          store.put('action', { ...action, status: 'completed' });
          events.publish('files-changed', { path: '.' }, workspace.id, run.id);
          return { status };
        } catch (error) {
          store.put('action', { ...action, status: 'unknown' });
          throw error;
        }
      },
    ),
    definition(
      'git_stage',
      'Stage or unstage paths in the Git index ("." for everything). Not undone by prompt revert.',
      {
        paths: z.array(z.string().min(1)).min(1).max(200),
        unstage: z.boolean().default(false),
      },
      async ({ paths, unstage }) => {
        const status = await gitStage(workspace, paths, unstage);
        events.publish('files-changed', { path: '.' }, workspace.id, run.id);
        return `${unstage ? 'Unstaged' : 'Staged'}. Status:\n${status.trimEnd().slice(0, 6_000)}`;
      },
    ),
    definition(
      'git_commit',
      'Commit the staged changes (git_stage first) after user approval. Hooks do not run; never amends or pushes. Not undone by prompt revert.',
      {
        message: z
          .string()
          .trim()
          .min(1)
          .max(10_000)
          .describe('Summary line, optionally a blank line and body.'),
      },
      async ({ message }) => {
        const { files, prefix } = await gitStaged(workspace);
        if (!files.length)
          throw new Error('Nothing is staged. Stage changes with git_stage first.');
        const outside = files.filter((file) => !file.startsWith(prefix));
        if (outside.length)
          throw new Error(
            `The index also contains changes outside this workspace (${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', …' : ''}). Ask the user to commit or unstage them.`,
          );
        const listed =
          files
            .slice(0, 50)
            .map((file) => `  ${file}`)
            .join('\n') + (files.length > 50 ? `\n  …and ${files.length - 50} more` : '');
        await permissions.ask(
          workspace.id,
          'Git commit',
          `Message:\n${message}\n\nStaged files (${files.length}):\n${listed}\n\nGit hooks are disabled for this commit. Prompt revert restores files but does not remove the commit.`,
          signal,
          run,
        );
        const action = store.action(
          workspace.id,
          `Git commit: ${message.split('\n')[0].slice(0, 100)}`,
          'Creates a commit in the repository history; prompt revert does not remove it.',
          run,
        );
        events.publish('state');
        try {
          const hooks = join(managedDirectory, 'empty-git-hooks');
          await mkdir(hooks, { recursive: true });
          const summary = await gitCommit(workspace, message, hooks);
          store.put('action', { ...action, status: 'completed' });
          events.publish('files-changed', { path: '.' }, workspace.id, run.id);
          return { committed: true, summary: summary.slice(0, 2_000) };
        } catch (error) {
          store.put('action', { ...action, status: 'unknown' });
          throw error;
        }
      },
    ),
  ];
}
