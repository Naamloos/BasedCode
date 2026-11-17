import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Events } from '../storage/events.js';
import { Store } from '../storage/store.js';
import { Workspaces } from './workspaces.js';
import { Worktrees } from './worktrees.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'basedcode-worktree-')));
const repository = join(root, 'repo');
const data = join(root, 'data');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
execFileSync('git', ['init', '-q', '-b', 'main', repository]);
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Test');
writeFileSync(join(repository, 'readme.md'), 'hello\n');
git('add', '.');
git('commit', '-q', '-m', 'initial');

const store = new Store(join(data, 'test.sqlite'));
const events = new Events();
const workspaces = new Workspaces({
  store,
  events,
  agent: { chatBusy: () => false },
  mcp: { closeWorkspace: async () => undefined, forgetRemoved: () => undefined },
  languages: { closeWorkspace: () => undefined },
  dataDirectory: data,
  assertIdle: () => undefined,
} as unknown as ConstructorParameters<typeof Workspaces>[0]);
const worktrees = new Worktrees({ store, events, workspaces, managedDirectory: join(data, 'servers'), assertIdle: () => undefined });
after(() => {
  store.db.close();
  rmSync(root, { recursive: true, force: true });
});

test('a worktree opens as its own workspace and is removed with its folder, keeping the branch', async () => {
  const origin = await workspaces.open(repository);
  const created = await worktrees.create(origin, 'feature/x');
  assert.equal(created.worktreeOf?.workspaceId, origin.id);
  assert.equal(created.worktreeOf?.branch, 'feature/x');
  assert.ok(existsSync(join(created.path, 'readme.md')));
  assert.ok(created.path.startsWith(`${repository}.worktrees`));

  const listed = await worktrees.list(origin);
  assert.ok(listed.some((item) => item.branch === 'feature/x' && item.managed && item.workspaceId === created.id));

  writeFileSync(join(created.path, 'draft.txt'), 'unsaved\n');
  await assert.rejects(worktrees.remove(created.id), /uncommitted/);
  await worktrees.remove(created.id, true);
  assert.ok(!existsSync(created.path));
  assert.ok(store.get('workspace', created.id).removedAt);
  assert.match(git('branch', '--list', 'feature/x'), /feature\/x/);
});

test('invalid branch names are refused before Git runs', async () => {
  const origin = await workspaces.open(repository);
  await assert.rejects(worktrees.create(origin, '--force'), /Invalid branch name/);
  await assert.rejects(worktrees.create(origin, 'a..b'), /Invalid branch name/);
});
