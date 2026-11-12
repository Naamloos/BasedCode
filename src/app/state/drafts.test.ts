import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearDraft, loadDraft, saveDraft, type DraftStorage } from './drafts.js';

function memory(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: key => void map.delete(key) };
}

test('drafts are stored per chat and cleared when emptied or deleted', () => {
  const storage = memory();
  saveDraft('a', 'hello', storage);
  saveDraft('b', 'other', storage);
  assert.equal(loadDraft('a', storage), 'hello');
  assert.equal(loadDraft('b', storage), 'other');
  saveDraft('a', '   ', storage);
  assert.equal(loadDraft('a', storage), '');
  assert.equal(storage.map.size, 1);
  clearDraft('b', storage);
  assert.equal(storage.map.size, 0);
});

test('no chat id means no draft is read or written', () => {
  const storage = memory();
  saveDraft('', 'text', storage);
  assert.equal(storage.map.size, 0);
  assert.equal(loadDraft('', storage), '');
});
