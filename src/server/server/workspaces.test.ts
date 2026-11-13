import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Events } from '../storage/events.js';
import { Store } from '../storage/store.js';
import { Workspaces, type WorkspaceDeps } from './workspaces.js';

function setup() {
  const store = new Store(':memory:');
  store.put('workspace', {
    id: 'workspace',
    name: 'Project',
    path: process.cwd(),
    settings: store.newWorkspaceSettings(),
  });
  const closed: string[] = [];
  const deps: WorkspaceDeps = {
    store,
    events: new Events(),
    agent: { chatBusy: () => false },
    mcp: {
      closeWorkspace: async (id) => { closed.push(id); },
      forgetRemoved: async () => {},
    },
    languages: { closeWorkspace: () => {} },
    dataDirectory: process.cwd(),
    assertIdle: () => {},
  };
  return { store, closed, deps, workspaces: new Workspaces(deps) };
}

test('archiving workspace chats preserves deletion and previous archive timestamps', () => {
  const { store, workspaces } = setup();
  try {
    for (const id of ['active', 'archived', 'deleted']) {
      store.put('chat', {
        id,
        workspaceId: 'workspace',
        title: id,
        createdAt: '2026-01-01T00:00:00Z',
        stale: false,
        ...(id === 'archived' ? { archivedAt: '2026-01-02T00:00:00Z' } : {}),
        ...(id === 'deleted' ? { deletedAt: '2026-01-03T00:00:00Z' } : {}),
      });
    }

    workspaces.clearChats('workspace', false);

    assert.ok(store.get('chat', 'active').archivedAt);
    assert.equal(store.get('chat', 'archived').archivedAt, '2026-01-02T00:00:00Z');
    assert.equal(store.get('chat', 'deleted').archivedAt, undefined);
    assert.equal(store.get('chat', 'deleted').deletedAt, '2026-01-03T00:00:00Z');
  } finally {
    store.db.close();
  }
});

test('workspace deletion checks active work before changing any chat', () => {
  const { store, deps, workspaces } = setup();
  try {
    store.put('chat', {
      id: 'chat',
      workspaceId: 'workspace',
      title: 'Work',
      createdAt: new Date().toISOString(),
      stale: false,
    });
    deps.agent.chatBusy = () => true;

    assert.throws(() => workspaces.clearChats('workspace', true), /active and queued/);
    assert.equal(store.get('chat', 'chat').deletedAt, undefined);
  } finally {
    store.db.close();
  }
});

test('workspace settings reject maintenance before disconnecting services or writing', async () => {
  const { store, closed, deps, workspaces } = setup();
  try {
    deps.assertIdle = () => { throw new Error('Busy'); };

    await assert.rejects(workspaces.updateMcpServers('workspace', []), /Busy/);

    assert.deepEqual(closed, []);
    assert.equal(store.get('workspace', 'workspace').removedAt, undefined);
  } finally {
    store.db.close();
  }
});

test('removing a workspace soft-deletes chats and retains the workspace path', async () => {
  const { store, closed, workspaces } = setup();
  try {
    store.put('chat', {
      id: 'chat',
      workspaceId: 'workspace',
      title: 'Work',
      createdAt: new Date().toISOString(),
      stale: false,
    });

    await workspaces.remove('workspace');

    assert.deepEqual(closed, ['workspace']);
    assert.ok(store.get('chat', 'chat').deletedAt);
    assert.ok(store.get('workspace', 'workspace').removedAt);
    assert.equal(store.get('workspace', 'workspace').path, process.cwd());
  } finally {
    store.db.close();
  }
});
