import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Store } from '../storage/store.js';
import { memoriesFor, memoryPrompt, saveMemory } from './memory.js';

const directory = mkdtempSync(join(tmpdir(), 'basedcode-memory-'));
const store = new Store(join(directory, 'test.sqlite'));
after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});

test('workspace memories apply only to their workspace; global ones everywhere', () => {
  saveMemory(store, { scope: 'global', content: 'Prefers British spelling.', source: 'user' });
  saveMemory(store, { scope: 'workspace', workspaceId: 'a', content: 'Uses pnpm, not npm.', source: 'agent' });
  saveMemory(store, { scope: 'workspace', workspaceId: 'b', content: 'Deploys on Fridays.', source: 'agent' });
  assert.deepEqual(
    memoriesFor(store, 'a').map((memory) => memory.content),
    ['Uses pnpm, not npm.', 'Prefers British spelling.'],
  );
  const prompt = memoryPrompt(store, 'a');
  assert.match(prompt, /Uses pnpm/);
  assert.doesNotMatch(prompt, /Fridays/);
});

test('duplicates, empty and overlong memories are refused', () => {
  assert.throws(() => saveMemory(store, { scope: 'global', content: 'Prefers British spelling.', source: 'agent' }), /already exists/);
  assert.throws(() => saveMemory(store, { scope: 'global', content: '   ', source: 'agent' }), /needs text/);
  assert.throws(() => saveMemory(store, { scope: 'global', content: 'x'.repeat(601), source: 'agent' }), /under 600/);
});

test('the agent cannot edit another workspace memory', () => {
  const other = memoriesFor(store, 'b').find((memory) => memory.scope === 'workspace')!;
  assert.throws(
    () => saveMemory(store, { id: other.id, scope: 'workspace', workspaceId: 'a', content: 'Changed.', source: 'agent' }),
    /No memory with that id/,
  );
});

test('turning memory off leaves it out of the prompt', () => {
  store.saveGlobal({ ...store.global(), memory: { enabled: false } });
  assert.equal(memoryPrompt(store, 'a'), '');
  store.saveGlobal({ ...store.global(), memory: { enabled: true } });
});
