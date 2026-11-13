import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectScope, ref } from 'vue';
import { useCommandPalette, type PaletteItem } from './commandPalette.js';

function item(id: string, section: string, label = id, hint?: string): PaletteItem {
  return { id, section, label, hint, icon: undefined, run: () => {} };
}

test('palette search matches all words across labels, sections and hints', () => {
  const scope = effectScope();
  try {
    const palette = scope.run(() => useCommandPalette(ref([
      item('one', 'Files', 'settings.ts', 'workspace'),
      item('two', 'Files', 'settings.ts', 'scratch'),
    ]), async (action) => action()));
    assert.ok(palette);

    palette.paletteText.value = 'workspace settings';

    assert.deepEqual(palette.paletteResults.value.map((entry) => entry.id), ['one']);
  } finally {
    scope.stop();
  }
});

test('palette groups results without changing the order inside a group', () => {
  const scope = effectScope();
  try {
    const palette = scope.run(() => useCommandPalette(ref([
      item('file', 'Files'),
      item('second-action', 'Actions'),
      item('chat', 'Chats'),
      item('first-action', 'Actions'),
      item('settings', 'Settings'),
    ]), async (action) => action()));
    assert.ok(palette);

    assert.deepEqual(palette.paletteResults.value.map((entry) => entry.id), [
      'chat', 'second-action', 'first-action', 'settings', 'file',
    ]);
  } finally {
    scope.stop();
  }
});

test('empty palette limits recent chats but search can reach older chats', () => {
  const scope = effectScope();
  try {
    const chats = Array.from({ length: 12 }, (_, index) => item(String(index), 'Chats'));
    const palette = scope.run(() => useCommandPalette(ref(chats), async (action) => action()));
    assert.ok(palette);

    assert.equal(palette.paletteResults.value.length, 8);
    palette.paletteText.value = '11';
    assert.deepEqual(palette.paletteResults.value.map((entry) => entry.id), ['11']);
  } finally {
    scope.stop();
  }
});
