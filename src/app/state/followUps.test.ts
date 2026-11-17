import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message, Run } from '../../shared/types';
import { currentFollowUps, dismissFollowUps, dismissedFollowUps, type FollowUpStorage } from './followUps.js';

const suggestions = [
  { label: 'Run the tests', prompt: 'Run npm test', action: 'send' },
  { label: 'Tweak it', prompt: 'Change the ', action: 'draft' },
];
let seq = 0;
function message(runId: string, role: Message['role'], metadata: Record<string, unknown> = {}): Message {
  return { id: `m${++seq}`, chatId: 'c', runId, role, content: '', metadata, createdAt: '' };
}
const call = (runId: string, status = 'completed', list: unknown = suggestions) =>
  message(runId, 'tool', { tool: { name: 'suggest_prompts', status, args: { suggestions: list } } });
const run = (id: string, status: Run['status'] = 'completed'): Run =>
  ({ id, chatId: 'c', workspaceId: 'w', prompt: '', status, createdAt: '' });

test('shows the latest call of a completed last prompt', () => {
  const first = call('r1');
  const second = call('r1', 'completed', [suggestions[1]]);
  const messages = [message('r1', 'user'), first, second, message('r1', 'assistant')];
  const result = currentFollowUps(messages, [run('r1')], []);
  assert.equal(result?.messageId, second.id);
  assert.deepEqual(result?.suggestions, [{ label: 'Tweak it', prompt: 'Change the', action: 'draft' }]);
});

test('hidden while running, after a later prompt, after steering, when failed or dismissed', () => {
  const tool = call('r1');
  const done = [message('r1', 'user'), tool, message('r1', 'assistant')];
  assert.equal(currentFollowUps(done, [run('r1', 'running')], []), undefined);
  assert.equal(currentFollowUps(done, [run('r1'), run('r2', 'queued')], []), undefined);
  assert.equal(currentFollowUps([...done, message('r2', 'user')], [run('r1'), run('r2')], []), undefined);
  assert.equal(currentFollowUps([...done, message('r1', 'user')], [run('r1')], []), undefined);
  assert.equal(currentFollowUps(done, [run('r1', 'failed')], []), undefined);
  assert.equal(currentFollowUps(done, [run('r1')], [tool.id]), undefined);
  assert.equal(currentFollowUps([message('r1', 'user'), call('r1', 'failed')], [run('r1')], []), undefined);
});

test('drops malformed suggestions and caps at three', () => {
  const list = [...suggestions, { label: '', prompt: 'x', action: 'send' }, { label: 'a', prompt: 'b', action: 'run' }, suggestions[0], suggestions[1]];
  const result = currentFollowUps([call('r1', 'completed', list)], [run('r1')], []);
  assert.equal(result?.suggestions.length, 3);
});

test('dismissals persist and stay bounded', () => {
  const map = new Map<string, string>();
  const storage: FollowUpStorage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
  for (let index = 0; index < 205; index++) dismissFollowUps(`id${index}`, storage);
  const ids = dismissedFollowUps(storage);
  assert.equal(ids.length, 200);
  assert.equal(ids.at(-1), 'id204');
  map.set('basedcode.followUps.dismissed', 'not json');
  assert.deepEqual(dismissedFollowUps(storage), []);
});
