import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalMode, Run } from '../../shared/types.js';
import { Store, defaultSettings } from '../storage/store.js';
import { Events } from '../storage/events.js';
import { Permissions, commandRule } from './permissions.js';

async function setup(mode: ApprovalMode) {
  const directory = await mkdtemp(join(tmpdir(), 'basedcode-perm-'));
  const store = new Store(join(directory, 'db.sqlite'));
  store.put('workspace', { id: 'w', path: directory, name: 'w', settings: { ...defaultSettings(), approvalMode: mode } });
  const permissions = new Permissions(store, new Events());
  const run = { id: 'r', chatId: 'c', workspaceId: 'w', prompt: 'p', status: 'running' } as Run;
  const cleanup = async () => { store.db.close(); await rm(directory, { recursive: true, force: true }); };
  /** Resolves the single pending approval once it appears. */
  const answer = async (approved: boolean) => {
    for (let i = 0; i < 50; i++) {
      const pending = store.all('approval').find(item => item.status === 'pending');
      if (pending) return permissions.decide(pending.id, approved);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('No pending approval appeared.');
  };
  return { store, permissions, run, cleanup, answer };
}

test('allow-all approves agent operations but never skips fallback consent', async () => {
  const { store, permissions, run, cleanup, answer } = await setup('allow-all');
  try {
    await permissions.ask('w', 'Run terminal command', 'ls', undefined, run);
    assert.equal(store.all('approval')[0].status, 'approved');
    const consent = permissions.ask('w', 'Provider fallback consent', 'x', undefined, run);
    await answer(false);
    await assert.rejects(consent, /denied/);
  } finally { await cleanup(); }
});

test('no-commands refuses commands, deletes, installs and MCP tools', async () => {
  const { permissions, run, cleanup } = await setup('no-commands');
  try {
    for (const title of ['Run terminal command', 'Run verification checks', 'Delete file', 'Install foo', 'MCP tool: x', 'Browser automation', 'Computer control', 'Computer screenshot']) {
      await assert.rejects(permissions.ask('w', title, '', undefined, run), /Refused/);
    }
  } finally { await cleanup(); }
});

test('per-tool remembers an approval per chat and title only', async () => {
  const { store, permissions, run, cleanup, answer } = await setup('per-tool');
  try {
    const first = permissions.ask('w', 'Run terminal command', 'a', undefined, run);
    await answer(true);
    await first;
    await permissions.ask('w', 'Run terminal command', 'b', undefined, run);
    assert.equal(store.all('approval').filter(item => item.status === 'pending').length, 0);
    const other = permissions.ask('w', 'Delete file', 'x', undefined, run);
    await answer(false);
    await assert.rejects(other, /denied/);
    const otherChat = permissions.ask('w', 'Run terminal command', 'c', undefined, { ...run, chatId: 'c2' });
    await answer(true);
    await otherChat;
  } finally { await cleanup(); }
});

test('operations without a run are never automated, and abort denies the pending approval', async () => {
  const { store, permissions, cleanup } = await setup('allow-all');
  try {
    const controller = new AbortController();
    const pending = permissions.ask('w', 'Run terminal command', 'x', controller.signal);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(store.all('approval')[0].status, 'pending');
    controller.abort();
    await assert.rejects(pending);
    assert.equal(store.all('approval')[0].status, 'denied');
    assert.throws(() => permissions.decide(store.all('approval')[0].id, true), /no longer pending/);
  } finally { await cleanup(); }
});

test('command rules: deny wins, allow must cover every segment', () => {
  const rules = { allow: ['npm test', 'git log *'], deny: ['rm -rf *'] };
  assert.equal(commandRule(rules, 'npm test')?.allowed, true);
  assert.equal(commandRule(rules, 'git log --oneline -5')?.allowed, true);
  assert.equal(commandRule(rules, 'npm test && git log')?.allowed, true);
  assert.equal(commandRule(rules, 'npm test; rm -rf ~')?.allowed, false);
  assert.equal(commandRule(rules, 'npm test && curl x'), undefined);
  assert.equal(commandRule(rules, 'git log $(whoami)'), undefined);
  assert.equal(commandRule(rules, 'npm run build'), undefined);
});

test('remembered commands skip the prompt next time', async () => {
  const { store, permissions, run, cleanup, answer } = await setup('always');
  try {
    const first = permissions.ask('w', 'Run terminal command', 'npm test', undefined, run, 'npm test');
    for (let i = 0; i < 50 && !store.all('approval').some(item => item.status === 'pending'); i++) await new Promise(resolve => setTimeout(resolve, 5));
    const pending = store.all('approval').find(item => item.status === 'pending')!;
    permissions.decide(pending.id, true, true);
    await first;
    assert.deepEqual(store.get('workspace', 'w').settings.commandRules?.allow, ['npm test']);
    await permissions.ask('w', 'Run terminal command', 'npm test', undefined, run, 'npm test');
    assert.equal(store.all('approval').filter(item => item.rule === 'npm test').length, 1);
    void answer;
  } finally { await cleanup(); }
});
