import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { DefineTool, ToolContext, ToolServices } from './definitions.js';
import { createTerminalTools } from './terminalTools.js';

test('SearXNG searches only the configured instance after approval', async (t) => {
  let instance = 'http://localhost:8080/searxng/';
  let approved = false;
  const context = {
    workspace: { id: 'workspace' },
    run: {},
    signal: new AbortController().signal,
  } as ToolContext;
  const services = {
    store: {
      global: () => ({ searxngUrl: instance }),
      action: () => ({ detail: 'search' }),
      put: () => {},
    },
    permissions: {
      ask: (_id: string, _purpose: string, detail: string) => {
        assert.match(detail, /localhost:8080\/searxng\/search\?q=a%26b&format=json/);
        approved = true;
      },
    },
  } as unknown as ToolServices;
  const define: DefineTool = (name, description, shape, handler) => ({
    name,
    description,
    shape,
    execute: (input) => handler(z.object(shape).strict().parse(input), () => {}),
  });
  const search = createTerminalTools(context, services, define).find(({ name }) => name === 'web_search');
  assert.ok(search);

  const fetchMock = t.mock.method(globalThis, 'fetch', (url: URL, init: RequestInit) => {
    assert.equal(approved, true);
    assert.equal(url.href, 'http://localhost:8080/searxng/search?q=a%26b&format=json');
    assert.equal(init.redirect, 'manual');
    return Promise.resolve(Response.json({
      results: [
        { title: 'Invalid', url: 'file:///example' },
        { title: 'Example', url: 'https://example.com/', content: 'Snippet' },
        { title: 'Over the limit', url: 'https://example.org/' },
      ],
    }));
  });

  assert.deepEqual(await search.execute({ query: 'a&b', limit: 1 }), {
    results: [{ title: 'Example', url: 'https://example.com/', snippet: 'Snippet' }],
  });
  instance = '';
  await assert.rejects(search.execute({ query: 'a&b' }), /Configure a SearXNG instance/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
