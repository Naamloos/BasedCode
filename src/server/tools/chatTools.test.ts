import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createChatTools } from './chatTools.js';
import type { DefineTool, ToolContext, ToolServices } from './definitions.js';

const define: DefineTool = (name, description, shape, handler) => ({
  name,
  description,
  shape,
  execute: (input) => handler(z.object(shape).strict().parse(input), () => {}),
});

test('chat history tools retrieve archived decisions and enforce workspace boundaries', async () => {
  const chats = [
    { id: 'current', workspaceId: 'here', title: 'Current' },
    { id: 'archived', workspaceId: 'here', title: 'Search decision', archivedAt: 'today' },
    { id: 'deleted', workspaceId: 'here', title: 'SearXNG', deletedAt: 'today' },
    { id: 'other', workspaceId: 'elsewhere', title: 'SearXNG' },
  ];
  const messages = chats.map(({ id }) => ({
    id: `${id}-message`,
    chatId: id,
    role: 'assistant',
    content: 'We picked SearXNG. ' + 'x'.repeat(3_100),
    createdAt: 'today',
    metadata: {},
  }));
  messages.push(
    { ...messages[1], id: 'next', content: 'Enable JSON output.' },
    { ...messages[1], id: 'reverted', metadata: { reverted: true } },
    { ...messages[1], id: 'raw-tool-output', role: 'tool' },
  );
  const context = { workspace: { id: 'here' }, run: { chatId: 'current' } } as ToolContext;
  const services = {
    store: {
      all: (kind: string) => kind === 'chat' ? chats : messages,
      get: (_kind: string, id: string) => chats.find((chat) => chat.id === id),
    },
  } as unknown as ToolServices;
  const tools = createChatTools(context, services, define);
  const search = tools.find(({ name }) => name === 'search_chats')!;
  const read = tools.find(({ name }) => name === 'read_chat')!;

  const reference = { chatId: 'archived', title: 'Search decision', link: '#chat/archived' };
  assert.deepEqual(await search.execute({ query: 'SEARCH DECISION' }), { results: [reference] });
  assert.deepEqual(await search.execute({ query: 'searxng' }), {
    results: [{ ...reference, messageId: 'archived-message', offset: 0, excerpt: messages[1].content.slice(0, 400) }],
  });

  assert.deepEqual(await read.execute({ chatId: 'archived', messageId: 'archived-message' }), {
    ...reference,
    message: { id: 'archived-message', role: 'assistant', createdAt: 'today', offset: 0, content: messages[1].content.slice(0, 3_000) },
    nextOffset: 3_000,
    nextMessageId: 'next',
  });
  for (const chatId of ['current', 'deleted', 'other'])
    await assert.rejects(read.execute({ chatId }), /Chat is unavailable/);
  for (const messageId of ['other-message', 'reverted', 'raw-tool-output'])
    await assert.rejects(read.execute({ chatId: 'archived', messageId }), /Message is unavailable/);
});

test('sidebar changes require approval and recheck access before writing', async () => {
  let chat = { id: 'target', workspaceId: 'here', title: 'Decision', pinned: false };
  let writes = 0;
  let moved = false;
  let denied = true;
  const context = {
    workspace: { id: 'here' },
    run: { chatId: 'target' },
    signal: new AbortController().signal,
  } as ToolContext;
  const services = {
    store: {
      get: () => chat,
      put: (_kind: string, updated: typeof chat) => { writes++; chat = updated; },
    },
    events: { publish: () => {} },
    permissions: {
      ask: async () => {
        if (denied) throw new Error('User denied.');
        if (moved) chat = { ...chat, workspaceId: 'elsewhere' };
      },
    },
  } as unknown as ToolServices;
  const tool = createChatTools(context, services, define).find(({ name }) => name === 'update_chat_sidebar')!;

  await assert.rejects(tool.execute({ action: 'pin' }), /User denied/);
  denied = false;
  moved = true;
  await assert.rejects(tool.execute({ action: 'archive' }), /Chat is unavailable/);
  await assert.rejects(tool.execute({ action: 'pin' }), /Chat is unavailable/);
  assert.equal(writes, 0);

  chat = { ...chat, workspaceId: 'here' };
  moved = false;
  assert.deepEqual(await tool.execute({ action: 'pin' }), {
    chatId: 'target', title: 'Decision', link: '#chat/target', pinned: true, archived: false,
  });
  assert.equal(writes, 1);
});
