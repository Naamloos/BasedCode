import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Events } from '../storage/events.js';
import { Store } from '../storage/store.js';
import { Chats, type ChatDeps } from './chats.js';

function setup() {
  const store = new Store(':memory:');
  const workspace = store.put('workspace', {
    id: 'workspace',
    name: 'Project',
    path: process.cwd(),
    settings: store.newWorkspaceSettings(),
  });
  const submitted: string[] = [];
  const deps: ChatDeps = {
    store,
    events: new Events(),
    agent: {
      chatBusy: () => false,
      submit: (chatId, prompt) => {
        submitted.push(prompt);
        return store.put('run', {
          id: 'submitted',
          chatId,
          workspaceId: workspace.id,
          prompt,
          status: 'queued',
          createdAt: new Date().toISOString(),
        });
      },
    },
    scratchDirectory: process.cwd(),
    inMaintenance: () => false,
    removeUnusedScratch: async () => false,
  };
  return { store, workspace, submitted, deps, chats: new Chats(deps) };
}

test('moving a chat rejects queued work and preserves the original workspace', async () => {
  const { store, workspace, chats } = setup();
  try {
    const chat = await chats.create({ workspaceId: workspace.id, scratch: false });
    store.put('workspace', { ...workspace, id: 'target' });
    store.put('run', {
      id: 'queued',
      chatId: chat.id,
      workspaceId: workspace.id,
      prompt: 'Work',
      status: 'queued',
      createdAt: new Date().toISOString(),
    });

    assert.throws(() => chats.move(chat.id, 'target'), /active and queued/);
    assert.equal(store.get('chat', chat.id).workspaceId, workspace.id);
  } finally {
    store.db.close();
  }
});

test('forking copies finished turns with new IDs and keeps checkpoint provenance', async () => {
  const { store, workspace, chats } = setup();
  try {
    const chat = await chats.create({ workspaceId: workspace.id, scratch: false });
    store.put('run', {
      id: 'original',
      chatId: chat.id,
      workspaceId: workspace.id,
      prompt: 'Work',
      status: 'completed',
      createdAt: new Date().toISOString(),
    });
    store.message(chat.id, 'original', 'assistant', 'Done');

    const fork = await chats.fork(chat.id, 'original');
    const copiedRun = store.all('run').find((run) => run.chatId === fork.id);
    const copiedMessage = store.all('message').find((message) => message.chatId === fork.id);

    assert.equal(fork.forkedFrom, chat.id);
    assert.ok(copiedRun);
    assert.notEqual(copiedRun.id, 'original');
    assert.equal(copiedRun.forkedFrom, 'original');
    assert.equal(copiedMessage?.runId, copiedRun.id);
    assert.equal(copiedMessage?.content, 'Done');
  } finally {
    store.db.close();
  }
});

test('mode handoff reopens a wrapped-up chat and submits the user context', async () => {
  const { store, workspace, submitted, chats } = setup();
  try {
    const chat = await chats.create({ workspaceId: workspace.id, scratch: false });
    store.put('chat', { ...chat, wrappedUpAt: new Date().toISOString() });

    const updated = chats.handOff(chat.id, 'refactor', 'Keep the public API');

    assert.equal(updated.mode, 'refactor');
    assert.equal(updated.wrappedUpAt, undefined);
    assert.match(submitted[0], /Keep the public API/);
  } finally {
    store.db.close();
  }
});

test('maintenance blocks handoff before changing the chat', async () => {
  const { store, workspace, deps, chats } = setup();
  try {
    const chat = await chats.create({ workspaceId: workspace.id, scratch: false });
    deps.inMaintenance = () => true;

    assert.throws(() => chats.handOff(chat.id, 'refactor'), /maintenance/);
    assert.equal(store.get('chat', chat.id).mode, 'default');
  } finally {
    store.db.close();
  }
});
