import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readdir, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { Change, Run, Workspace } from '../../shared/types.js';
import { Store } from '../storage/store.js';
import { excludedDirectories, safePath } from './workspace.js';

/** One file in a checkpoint: its git blob id and permission bits. */
interface Version {
  hash: string;
  mode: number;
}
export type Manifest = Record<string, Version>;
interface RestoreJournal {
  workspace: Workspace;
  current: Manifest;
  target: Manifest;
  paths: string[];
}

const maxFileBytes = 32 * 1024 * 1024;
const sameVersion = (first?: Version, second?: Version) =>
  first?.hash === second?.hash && first?.mode === second?.mode;

/**
 * Prompt checkpoints stored as git trees in a private repository per workspace, under app data and never in the
 * workspace's own .git. Each capture stages the workspace into that repository's index and writes a tree; a ref per
 * checkpoint keeps its objects from being collected. Revert compares and restores individual files from those trees.
 */
export class Checkpoints {
  /** Serializes git operations per workspace, since they share one index. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly directory: string,
  ) {}

  get hasRecovery(): boolean {
    return Boolean(this.store.db.prepare('SELECT id FROM restore_journal LIMIT 1').get());
  }

  private gitDirectory(workspace: Workspace): string {
    return join(this.directory, workspace.id);
  }

  private git(workspace: Workspace, args: string[], input?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'git',
        [
          ...['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.longpaths=true'],
          ...['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.symlinks=false'],
          ...['-c', 'gc.auto=0'],
          ...args,
        ],
        {
          cwd: workspace.path,
          windowsHide: true,
          env: {
            ...process.env,
            GIT_DIR: this.gitDirectory(workspace),
            GIT_WORK_TREE: workspace.path,
            // The user's own git config (filters, hooks, excludes) must not change what a checkpoint holds.
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: join(this.directory, 'empty.gitconfig'),
            GIT_TERMINAL_PROMPT: '0',
            GIT_AUTHOR_NAME: 'BasedCode',
            GIT_AUTHOR_EMAIL: 'checkpoints@basedcode.local',
            GIT_COMMITTER_NAME: 'BasedCode',
            GIT_COMMITTER_EMAIL: 'checkpoints@basedcode.local',
          },
        },
      );
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
      child.on('error', (error) =>
        reject(new Error(`Checkpoints need git on PATH: ${error.message}`)),
      );
      child.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(out));
        else
          reject(
            new Error(
              `git ${args[0]} failed: ${Buffer.concat(err).toString('utf8').trim() || `exit ${code}`}`,
            ),
          );
      });
      child.stdin.end(input ?? '');
    });
  }

  private exclusive<T>(workspace: Workspace, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(workspace.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.locks.set(workspace.id, next);
    return next;
  }

  private async ensureRepository(workspace: Workspace): Promise<void> {
    if (existsSync(join(this.gitDirectory(workspace), 'HEAD'))) return;
    await mkdir(this.gitDirectory(workspace), { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, 'empty.gitconfig'), '', { flag: 'a' });
    await this.git(workspace, ['init', '--quiet']);
  }

  /** Paths a checkpoint leaves out: excluded directories, nested repositories, links, special and oversized files. */
  private async skipped(workspace: Workspace): Promise<{ path: string; reason?: string }[]> {
    const skipped: { path: string; reason?: string }[] = [];
    let count = 0;
    const walk = async (directory: string, prefix = '') => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (++count > 200_000) throw new Error('Checkpoint exceeds 200,000 entries.');
        if (entry.isSymbolicLink()) skipped.push({ path, reason: 'link' });
        else if (entry.isDirectory()) {
          if (excludedDirectories.has(entry.name.toLowerCase())) skipped.push({ path });
          else if (existsSync(join(directory, entry.name, '.git')))
            skipped.push({ path, reason: 'nested git repository' });
          else await walk(join(directory, entry.name), path);
        } else if (!entry.isFile()) skipped.push({ path, reason: 'special file' });
        else if ((await lstat(join(directory, entry.name))).size > maxFileBytes)
          skipped.push({ path, reason: 'over 32 MiB' });
      }
    };
    await walk(workspace.path);
    return skipped;
  }

  /**
   * Unexpected paths skipped by snapshots, shown so users know which effects prompt revert cannot restore.
   * Standard excluded directories are listed in the approval prompt already, so they are skipped silently here.
   */
  async coverageWarnings(workspace: Workspace): Promise<string[]> {
    return (await this.skipped(workspace))
      .filter((item) => item.reason)
      .map((item) => `${item.path} (${item.reason})`)
      .slice(0, 200);
  }

  /** Stages the workspace into the checkpoint repository's index and returns the tree id. */
  private async writeTree(workspace: Workspace): Promise<string> {
    await this.ensureRepository(workspace);
    const skipped = await this.skipped(workspace);
    const pathspecs = ['.', ...skipped.map((item) => `:(exclude,literal)${item.path}`)];
    // -f: gitignored files are covered too (excluded build folders aside), since the agent can change them.
    await this.git(
      workspace,
      ['add', '-A', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'],
      pathspecs.join('\0'),
    );
    return (await this.git(workspace, ['write-tree'])).toString('utf8').trim();
  }

  private async manifestOf(workspace: Workspace, tree: string): Promise<Manifest> {
    const manifest: Manifest = Object.create(null);
    const listing = (
      await this.git(workspace, ['ls-tree', '-r', '-z', '--full-tree', tree])
    ).toString('utf8');
    for (const line of listing.split('\0')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      const [mode, type, hash] = line.slice(0, tab).split(' ');
      if (type !== 'blob') continue;
      manifest[line.slice(tab + 1)] = { hash, mode: mode === '100755' ? 0o755 : 0o644 };
    }
    return manifest;
  }

  async capture(workspace: Workspace): Promise<Manifest> {
    return this.exclusive(workspace, async () =>
      this.manifestOf(workspace, await this.writeTree(workspace)),
    );
  }

  /** Records a checkpoint tree for a run, pinned by a ref so git never collects it. */
  private async record(
    workspace: Workspace,
    runId: string,
    which: 'before' | 'after',
  ): Promise<string> {
    return this.exclusive(workspace, async () => {
      const tree = await this.writeTree(workspace);
      const commit = (await this.git(workspace, ['commit-tree', tree, '-m', `${runId} ${which}`]))
        .toString('utf8')
        .trim();
      await this.git(workspace, ['update-ref', `refs/checkpoints/${runId}/${which}`, commit]);
      return `git:${tree}`;
    });
  }

  async begin(workspace: Workspace, runId: string): Promise<void> {
    if (this.hasRecovery)
      throw new Error('Resolve the interrupted restore before starting another task.');
    const state = await this.record(workspace, runId, 'before');
    this.store.db
      .prepare('INSERT OR REPLACE INTO checkpoints(run_id, before_state) VALUES (?, ?)')
      .run(runId, state);
  }

  async finish(workspace: Workspace, runId: string): Promise<void> {
    const state = await this.record(workspace, runId, 'after');
    this.store.db
      .prepare('UPDATE checkpoints SET after_state = ? WHERE run_id = ?')
      .run(state, runId);
  }

  private async manifest(
    workspace: Workspace,
    runId: string,
    which: 'before' | 'after',
  ): Promise<Manifest> {
    const row = this.store.db
      .prepare('SELECT before_state, after_state FROM checkpoints WHERE run_id = ?')
      .get(runId);
    if (!row) throw new Error('This prompt has no checkpoint.');
    const value = String((which === 'before' ? row.before_state : row.after_state) ?? '');
    if (!value)
      throw new Error(
        'This prompt has no completed checkpoint. Its effects require manual inspection.',
      );
    if (!value.startsWith('git:'))
      throw new Error(
        'This prompt was checkpointed by an older version of BasedCode, so its changes cannot be shown or reverted.',
      );
    return this.manifestOf(workspace, value.slice(4));
  }

  async changes(workspace: Workspace, runId: string): Promise<Change[]> {
    const row = this.store.db
      .prepare('SELECT after_state FROM checkpoints WHERE run_id = ?')
      .get(runId);
    if (!row) return [];
    const before = await this.manifest(workspace, runId, 'before');
    const current = row.after_state
      ? await this.manifest(workspace, runId, 'after')
      : await this.capture(workspace);
    return this.describe(workspace, before, current);
  }

  private blob(workspace: Workspace, hash: string): Promise<Buffer> {
    return this.git(workspace, ['cat-file', 'blob', hash]);
  }

  private async describe(
    workspace: Workspace,
    before: Manifest,
    after: Manifest,
  ): Promise<Change[]> {
    const changes: Change[] = [];
    for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (sameVersion(before[path], after[path])) continue;
      const oldBytes = before[path]
        ? await this.blob(workspace, before[path].hash)
        : Buffer.alloc(0);
      const newBytes = after[path]
        ? await this.blob(workspace, after[path].hash)
        : Buffer.alloc(0);
      const binary =
        oldBytes.includes(0) ||
        newBytes.includes(0) ||
        oldBytes.length + newBytes.length > 2 * 1024 * 1024;
      changes.push({
        path,
        kind: !before[path] ? 'created' : !after[path] ? 'deleted' : 'modified',
        binary,
        diff: binary
          ? 'Binary or oversized file changed.'
          : createTwoFilesPatch(
              `a/${path}`,
              `b/${path}`,
              oldBytes.toString('utf8'),
              newBytes.toString('utf8'),
            ),
      });
    }
    return changes;
  }

  async previewRevert(
    workspace: Workspace,
    run: Run,
  ): Promise<{
    paths: string[];
    conflicts: string[];
    actions: string[];
    target: Manifest;
    current: Manifest;
  }> {
    const runs = this.store
      .all('run')
      .filter((item) => item.chatId === run.chatId && !item.reverted);
    const index = runs.findIndex((item) => item.id === run.id);
    if (index < 0) throw new Error('This prompt has already been reverted.');
    const removed = runs.slice(index);
    const target = await this.manifest(workspace, run.id, 'before');
    const expected: Manifest = Object.assign(Object.create(null), target);
    const affected = new Set<string>();
    const intervening = new Set<string>();
    for (const item of removed) {
      const before = await this.manifest(workspace, item.id, 'before');
      const after = await this.manifest(workspace, item.id, 'after');
      const changed = new Set(
        [...Object.keys(before), ...Object.keys(after)].filter(
          (path) => !sameVersion(before[path], after[path]),
        ),
      );
      for (const path of new Set([...affected, ...changed])) {
        if (!sameVersion(before[path], expected[path])) intervening.add(path);
      }
      for (const path of changed) affected.add(path);
      for (const path of affected) {
        if (after[path]) expected[path] = after[path];
        else delete expected[path];
      }
    }
    const current = await this.capture(workspace);
    const paths = [...affected];
    const conflicts = paths.filter(
      (path) => intervening.has(path) || !sameVersion(current[path], expected[path]),
    );
    const ids = new Set(removed.map((item) => item.id));
    const actions = this.store
      .all('action')
      .filter((action) => action.runId && ids.has(action.runId))
      .map((action) => action.title);
    return { paths, conflicts, actions, target, current };
  }

  private async restore(workspace: Workspace, manifest: Manifest, paths: string[]): Promise<void> {
    const emptied = new Set<string>();
    for (const name of paths) {
      if (manifest[name]) continue;
      const path = await safePath(workspace, name, true);
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      for (let parent = dirname(name); parent !== '.' && parent !== ''; parent = dirname(parent))
        emptied.add(parent);
    }
    // Git does not track folders, so remove the ones the deleted files leave empty, deepest first.
    const kept = Object.keys(manifest);
    for (const name of [...emptied].sort((a, b) => b.length - a.length)) {
      if (kept.some((path) => path.startsWith(`${name}/`))) continue;
      try {
        const path = await safePath(workspace, name, true);
        if (!(await readdir(path)).length) await rmdir(path);
      } catch {
        /* Missing or non-empty folders stay as they are. */
      }
    }
    for (const name of paths) {
      const wanted = manifest[name];
      if (!wanted) continue;
      const path = await safePath(workspace, name, true);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await this.blob(workspace, wanted.hash), { mode: wanted.mode });
      await chmod(path, wanted.mode);
    }
  }

  async revert(workspace: Workspace, run: Run): Promise<string> {
    if (this.hasRecovery) throw new Error('Resolve the interrupted restore first.');
    const preview = await this.previewRevert(workspace, run);
    if (preview.conflicts.length)
      throw new Error(
        `Revert conflicts: ${preview.conflicts.join(', ')}. Resolve these edits before retrying.`,
      );
    const journal: RestoreJournal = {
      workspace,
      current: preview.current,
      target: preview.target,
      paths: preview.paths,
    };
    this.store.db
      .prepare('INSERT INTO restore_journal(id, body) VALUES (?, ?)')
      .run(run.id, JSON.stringify(journal));
    try {
      await this.restore(workspace, preview.target, preview.paths);
      this.store.transaction(() => {
        const active = this.store
          .all('run')
          .filter((item) => item.chatId === run.chatId && !item.reverted);
        const removed = new Set(
          active.slice(active.findIndex((item) => item.id === run.id)).map((item) => item.id),
        );
        for (const item of active)
          if (removed.has(item.id)) this.store.put('run', { ...item, reverted: true });
        for (const message of this.store.all('message')) {
          if (removed.has(message.runId))
            this.store.put('message', {
              ...message,
              metadata: { ...message.metadata, reverted: true },
            });
        }
        for (const action of this.store.all('action')) {
          if (action.runId && removed.has(action.runId))
            this.store.put('action', { ...action, reverted: true });
        }
        for (const chat of this.store.all('chat')) {
          if (chat.workspaceId === workspace.id && chat.id !== run.chatId)
            this.store.put('chat', { ...chat, stale: true });
        }
        this.store.db.prepare('DELETE FROM restore_journal WHERE id = ?').run(run.id);
      });
    } catch (error) {
      try {
        await this.restore(workspace, preview.current, preview.paths);
        this.store.db.prepare('DELETE FROM restore_journal WHERE id = ?').run(run.id);
      } catch {
        throw new Error(
          'Restore failed and recovery is required. Execution is blocked; use Recover Restore before continuing.',
        );
      }
      throw error;
    }
    return run.prompt;
  }

  /**
   * Snapshot taken just before a tool call that can change files, so the run can be rewound to that point.
   * Pinned by a ref under the run's own checkpoint refs.
   */
  async snapshotTool(workspace: Workspace, runId: string, messageId: string): Promise<void> {
    const state = await this.exclusive(workspace, async () => {
      const tree = await this.writeTree(workspace);
      const commit = (await this.git(workspace, ['commit-tree', tree, '-m', `${runId} tool ${messageId}`]))
        .toString('utf8')
        .trim();
      await this.git(workspace, ['update-ref', `refs/checkpoints/${runId}/tool/${messageId}`, commit]);
      return `git:${tree}`;
    });
    this.store.db
      .prepare('INSERT OR REPLACE INTO tool_checkpoints(message_id, run_id, state) VALUES (?, ?, ?)')
      .run(messageId, runId, state);
  }

  hasToolSnapshot(messageId: string): boolean {
    return Boolean(
      this.store.db.prepare('SELECT 1 FROM tool_checkpoints WHERE message_id = ?').get(messageId),
    );
  }

  /** Files as they were before a tool call. */
  async toolManifest(workspace: Workspace, messageId: string): Promise<Manifest> {
    const row = this.store.db
      .prepare('SELECT state FROM tool_checkpoints WHERE message_id = ?')
      .get(messageId);
    if (!row) throw new Error('This tool call has no snapshot to rewind to.');
    return this.manifestOf(workspace, String(row.state).slice(4));
  }

  /** A run's before or after file state. */
  runManifest(workspace: Workspace, runId: string, which: 'before' | 'after'): Promise<Manifest> {
    return this.manifest(workspace, runId, which);
  }

  /** Re-records a run's after state, for when its outcome changed (rewind, keeping a comparison result). */
  async refreshAfter(workspace: Workspace, runId: string): Promise<void> {
    await this.finish(workspace, runId);
  }

  /**
   * Which files a switch from `expected` (what the workspace should hold now) to `target` would write, and which of
   * them were edited since, so the switch would lose work.
   */
  async previewSwitch(
    workspace: Workspace,
    expected: Manifest,
    target: Manifest,
  ): Promise<{ paths: string[]; conflicts: string[]; current: Manifest }> {
    const paths = [...new Set([...Object.keys(expected), ...Object.keys(target)])].filter(
      (path) => !sameVersion(expected[path], target[path]),
    );
    const current = await this.capture(workspace);
    const conflicts = paths.filter((path) => !sameVersion(current[path], expected[path]));
    return { paths, conflicts, current };
  }

  /**
   * Moves the workspace files from `expected` to `target`, journaled like a revert. `commit` updates records in the
   * same transaction that clears the journal, so a crash leaves either the old state or the new one.
   */
  async switchState(
    workspace: Workspace,
    expected: Manifest,
    target: Manifest,
    journalId: string,
    commit: () => void,
  ): Promise<string[]> {
    if (this.hasRecovery) throw new Error('Resolve the interrupted restore first.');
    const preview = await this.previewSwitch(workspace, expected, target);
    if (preview.conflicts.length)
      throw new Error(
        `These files changed since: ${preview.conflicts.join(', ')}. Resolve these edits before retrying.`,
      );
    const journal: RestoreJournal = {
      workspace,
      current: preview.current,
      target,
      paths: preview.paths,
    };
    this.store.db
      .prepare('INSERT INTO restore_journal(id, body) VALUES (?, ?)')
      .run(journalId, JSON.stringify(journal));
    try {
      await this.restore(workspace, target, preview.paths);
      this.store.transaction(() => {
        commit();
        this.store.db.prepare('DELETE FROM restore_journal WHERE id = ?').run(journalId);
      });
    } catch (error) {
      try {
        await this.restore(workspace, preview.current, preview.paths);
        this.store.db.prepare('DELETE FROM restore_journal WHERE id = ?').run(journalId);
      } catch {
        throw new Error(
          'Restore failed and recovery is required. Execution is blocked; use Recover Restore before continuing.',
        );
      }
      throw error;
    }
    return preview.paths;
  }

  /** Changed files between two states, with diffs. */
  diffStates(workspace: Workspace, before: Manifest, after: Manifest): Promise<Change[]> {
    return this.describe(workspace, before, after);
  }

  async recover(): Promise<void> {
    for (const row of this.store.db.prepare('SELECT id, body FROM restore_journal').all()) {
      const journal = JSON.parse(String(row.body)) as RestoreJournal;
      await this.restore(journal.workspace, journal.current, journal.paths);
      this.store.db.prepare('DELETE FROM restore_journal WHERE id = ?').run(row.id as string);
    }
  }

  /** Deletes a workspace's checkpoint repository, for removed non-workspace chats. */
  async forget(workspace: Workspace): Promise<void> {
    await this.exclusive(workspace, () =>
      rm(this.gitDirectory(workspace), { recursive: true, force: true }),
    );
  }
}
