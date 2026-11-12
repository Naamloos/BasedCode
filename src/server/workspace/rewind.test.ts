import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Workspace } from '../../shared/types.js';
import { Store } from '../storage/store.js';
import { Checkpoints } from './checkpoints.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'checkpoints-'));
  const folder = await mkdtemp(join(tmpdir(), 'workspace-'));
  const store = new Store(join(root, 'db.sqlite'));
  const workspace: Workspace = { id: 'w1', path: folder, name: 'w', settings: { checks: [], editor: { command: '', args: [] } } };
  return { store, workspace, folder, checkpoints: new Checkpoints(store, join(root, 'checkpoints')) };
}

test('rewinding to a tool snapshot restores the files from just before that call', async () => {
  const { store, workspace, folder, checkpoints } = await setup();
  await writeFile(join(folder, 'a.txt'), 'start');
  await checkpoints.begin(workspace, 'run1');
  await writeFile(join(folder, 'a.txt'), 'first edit');
  await checkpoints.snapshotTool(workspace, 'run1', 'tool2');
  await writeFile(join(folder, 'a.txt'), 'second edit');
  await writeFile(join(folder, 'b.txt'), 'new file');
  await checkpoints.finish(workspace, 'run1');

  assert.ok(checkpoints.hasToolSnapshot('tool2'));
  const expected = await checkpoints.runManifest(workspace, 'run1', 'after');
  const target = await checkpoints.toolManifest(workspace, 'tool2');
  const preview = await checkpoints.previewSwitch(workspace, expected, target);
  assert.deepEqual(preview.paths.sort(), ['a.txt', 'b.txt']);
  assert.deepEqual(preview.conflicts, []);

  let committed = false;
  // A nested transaction in the commit must join the outer one.
  await checkpoints.switchState(workspace, expected, target, 'j1', () => {
    store.transaction(() => {
      committed = true;
    });
  });
  assert.ok(committed);
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'first edit');
  await assert.rejects(readFile(join(folder, 'b.txt'), 'utf8'));
  assert.equal(checkpoints.hasRecovery, false);
});

test('a switch is refused when files changed since the expected state', async () => {
  const { workspace, folder, checkpoints } = await setup();
  await writeFile(join(folder, 'a.txt'), 'start');
  await checkpoints.begin(workspace, 'run1');
  await writeFile(join(folder, 'a.txt'), 'agent edit');
  await checkpoints.finish(workspace, 'run1');
  await writeFile(join(folder, 'a.txt'), 'user edit');
  const before = await checkpoints.runManifest(workspace, 'run1', 'before');
  const after = await checkpoints.runManifest(workspace, 'run1', 'after');
  await assert.rejects(checkpoints.switchState(workspace, after, before, 'j2', () => undefined), /changed since/);
  assert.equal(await readFile(join(folder, 'a.txt'), 'utf8'), 'user edit');
});
