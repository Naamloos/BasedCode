import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Run, ServerConfig, Workspace } from '../../shared/types.js';
import { McpConnections } from './mcp.js';

function withClient(client: Pick<Client, 'getServerCapabilities' | 'listResources' | 'listResourceTemplates' | 'listPrompts'>) {
  const mcp = new McpConnections(...([] as unknown as ConstructorParameters<typeof McpConnections>));
  mcp.connect = async () => client as Client;
  mcp.server = () => ({ id: 'server' }) as ServerConfig;
  return mcp;
}

test('MCP discovery follows resource, template, and prompt cursors and exposes individual pages', async () => {
  const client = {
    getServerCapabilities: () => ({ resources: {}, prompts: {} }),
    listResources: async (params) => ({
      resources: [{ name: params?.cursor ?? 'first', uri: 'test://data' }],
      nextCursor: params?.cursor ? undefined : 'second',
    }),
    listResourceTemplates: async (params) => ({
      resourceTemplates: [{ name: params?.cursor ?? 'first', uriTemplate: 'test://{id}' }],
      nextCursor: params?.cursor ? undefined : 'second',
    }),
    listPrompts: async (params) => ({
      prompts: [{ name: params?.cursor ?? 'first' }],
      nextCursor: params?.cursor ? undefined : 'second',
    }),
  } satisfies Parameters<typeof withClient>[0];
  const mcp = withClient(client);
  const workspace = {} as Workspace;
  const run = {} as Run;
  const signal = new AbortController().signal;
  const catalog = await mcp.discover(workspace, 'server', signal, run);
  for (const entries of [catalog.resources, catalog.resourceTemplates, catalog.prompts])
    assert.deepEqual(entries.map(({ name }) => name), ['first', 'second']);
  assert.equal((await mcp.resourcePage(workspace, 'server', 'resources', undefined, signal, run)).nextCursor, 'second');

  client.listResources = async () => ({ resources: [], nextCursor: 'repeated' });
  await assert.rejects(mcp.discover(workspace, 'server', signal, run), /repeated a pagination cursor/);
});
