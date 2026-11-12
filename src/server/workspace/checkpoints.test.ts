import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Run, Workspace } from '../../shared/types.js';
import { Store, defaultSettings } from '../storage/store.js';
import { Checkpoints } from './checkpoints.js';
import { safePath } from './workspace.js';

async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'basedcode-cp-')));
  const root = join(base, 'ws');
  await mkdir(root);
  const store = new Store(join(base, 'data', 'db.sqlite'));
  const workspace: Workspace = { id: 'w', path: root, name: 'ws', settings: defaultSettings() };
  store.put('workspace', workspace);
  const checkpoints = new Checkpoints(store, join(base, 'data', 'objects'));
  let n = 0;
  const run = async (change: () => Promise<void>): Promise<Run> => {
    const item = { id: `r${++n}`, chatId: 'c', workspaceId: 'w', prompt: `p${n}`, status: 'completed' } as Run;
    store.put('run', item);
    await checkpoints.begin(workspace, item.id);
    await change();
    await checkpoints.finish(workspace, item.id);
    return item;
  };
  const cleanup = async () => { store.db.close(); await rm(base, { recursive: true, force: true }); };
  return { store, workspace, checkpoints, run, root, cleanup };
}

test('changes reports created, modified and deleted files', async () => {
  const { workspace, checkpoints, run, root, cleanup } = await setup();
  try {
    await writeFile(join(root, 'keep.txt'), 'old');
    await writeFile(join(root, 'gone.txt'), 'x');
    const item = await run(async () => {
      await writeFile(join(root, 'keep.txt'), 'new');
      await rm(join(root, 'gone.txt'));
      await writeFile(join(root, 'added.txt'), 'hi');
    });
    const kinds = Object.fromEntries((await checkpoints.changes(workspace, item.id)).map(change => [change.path, change.kind]));
    assert.deepEqual(kinds, { 'keep.txt': 'modified', 'gone.txt': 'deleted', 'added.txt': 'created' });
  } finally { await cleanup(); }
});

test('revert restores the before state of the prompt and every later prompt', async () => {
  const { store, workspace, checkpoints, run, root, cleanup } = await setup();
  try {
    await writeFile(join(root, 'a.txt'), 'v0');
    const first = await run(async () => { await writeFile(join(root, 'a.txt'), 'v1'); await mkdir(join(root, 'dir')); await writeFile(join(root, 'dir', 'b.txt'), 'b'); });
    await run(async () => { await writeFile(join(root, 'a.txt'), 'v2'); });
    await checkpoints.revert(workspace, first);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'v0');
    assert.equal(existsSync(join(root, 'dir')), false);
    assert.ok(store.all('run').every(item => item.reverted));
    assert.equal(checkpoints.hasRecovery, false);
  } finally { await cleanup(); }
});

test('revert refuses when files changed outside the recorded prompts', async () => {
  const { workspace, checkpoints, run, root, cleanup } = await setup();
  try {
    await writeFile(join(root, 'a.txt'), 'v0');
    const item = await run(async () => { await writeFile(join(root, 'a.txt'), 'v1'); });
    await writeFile(join(root, 'a.txt'), 'user edit');
    await assert.rejects(checkpoints.revert(workspace, item), /conflicts: a\.txt/);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'user edit');
  } finally { await cleanup(); }
});

test('an interrupted restore journal blocks new tasks until recovered', async () => {
  const { store, workspace, checkpoints, root, cleanup } = await setup();
  try {
    await writeFile(join(root, 'a.txt'), 'current');
    const current = await checkpoints.capture(workspace);
    await writeFile(join(root, 'a.txt'), 'half-restored');
    store.db.prepare('INSERT INTO restore_journal(id, body) VALUES (?, ?)').run('x', JSON.stringify({ workspace, current, target: {}, paths: ['a.txt'] }));
    assert.equal(checkpoints.hasRecovery, true);
    await assert.rejects(checkpoints.begin(workspace, 'new'), /interrupted restore/);
    await checkpoints.recover();
    assert.equal(checkpoints.hasRecovery, false);
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'current');
  } finally { await cleanup(); }
});

test('capture skips excluded directories; safePath blocks escapes and excluded mutations', async () => {
  const { workspace, checkpoints, root, cleanup } = await setup();
  try {
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'x.js'), '');
    assert.deepEqual(Object.keys(await checkpoints.capture(workspace)), []);
    await assert.rejects(safePath(workspace, '../outside.txt'), /outside the selected workspace/);
    await assert.rejects(safePath(workspace, ''), /valid workspace-relative path/);
    await assert.rejects(safePath(workspace, 'node_modules/x.js', true), /checkpoint coverage/);
    assert.equal(await safePath(workspace, 'node_modules/x.js'), join(root, 'node_modules', 'x.js'));
  } finally { await cleanup(); }
});
