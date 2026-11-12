import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildServer, installOptions, searchRegistry } from './mcpRegistry.js';

test('MCP Central and Truespar entries become registry servers', async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const parsed = new URL(url);
    urls.push(parsed);
    const body = parsed.hostname === 'central.example'
      ? {
          servers: [
            {
              name: 'io.example/files',
              version: '1.2.0',
              icon_url: 'https://example.com/icon.png',
              packages: npmServer.packages,
            },
          ],
          next_cursor: 'abc',
        }
      : {
          total: 31,
          results: [
            {
              key: 'reg:com.example/mcp',
              name: 'Example',
              remoteEndpoints: [{ transport: 'sse', url: 'https://example.com/sse' }],
            },
          ],
        };
    return new Response(JSON.stringify(body));
  });
  const central = await searchRegistry(
    { id: 'c', name: 'C', url: 'https://central.example/api', enabled: true, format: 'mcpcentral' },
    'files',
  );
  assert.equal(central.nextCursor, 'abc');
  assert.equal(central.servers[0]!.icon, 'https://example.com/icon.png');
  assert.equal(central.servers[0]!.options[0]!.kind, 'package');
  assert.equal(urls[0]!.searchParams.get('search'), 'files');

  const truespar = await searchRegistry(
    { id: 't', name: 'T', url: 'https://truespar.example/v1', enabled: true, format: 'truespar' },
    'mail',
    '30',
  );
  assert.equal(urls[1]!.searchParams.get('q'), 'mail');
  assert.equal(urls[1]!.searchParams.get('offset'), '30');
  assert.equal(truespar.nextCursor, undefined); // 30 + 1 reaches the total of 31.
  assert.equal(truespar.servers[0]!.name, 'reg:com.example/mcp');
  assert.equal(truespar.servers[0]!.title, 'Example');
  assert.equal(truespar.servers[0]!.options[0]!.transport, 'sse');
});

test('later registry pages send the cursor without a limit', async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(new URL(url));
    return new Response(JSON.stringify({ servers: [], metadata: { nextCursor: 'next' } }));
  });
  const registry = { id: 'github', name: 'GitHub', url: 'https://registry.example/v0.1/', enabled: true };
  await searchRegistry(registry, 'git');
  await searchRegistry(registry, 'git', 'mcp.cursor.abc');
  assert.equal(urls[0]!.searchParams.get('limit'), '30');
  assert.equal(urls[0]!.searchParams.has('cursor'), false);
  assert.equal(urls[1]!.searchParams.get('cursor'), 'mcp.cursor.abc');
  assert.equal(urls[1]!.searchParams.has('limit'), false);
  assert.equal(urls[1]!.searchParams.get('search'), 'git');
});

const npmServer = {
  name: 'io.example/files',
  description: 'Files',
  version: '1.2.0',
  packages: [
    {
      registryType: 'npm',
      identifier: '@example/files-mcp',
      version: '1.2.0',
      transport: { type: 'stdio' },
      packageArguments: [
        { type: 'positional' as const, valueHint: 'root', isRequired: true },
        { type: 'named' as const, name: '--mode', value: 'read' },
      ],
      environmentVariables: [
        { name: 'API_KEY', isRequired: true, isSecret: true },
        { name: 'LOG_LEVEL', default: 'info' },
      ],
    },
  ],
};

test('npm packages become npx commands with secrets kept apart', () => {
  const [option] = installOptions(npmServer);
  assert.equal(option?.transport, 'stdio');
  assert.deepEqual(
    option?.fields.map((field) => [field.key, field.required, field.secret]),
    [
      ['env.API_KEY', true, true],
      ['env.LOG_LEVEL', false, false],
      ['packageArg.0', true, false],
    ],
  );
  const { config, secrets } = buildServer('official', npmServer, 'package:0', {
    'env.API_KEY': 'sk-123',
    'packageArg.0': '/data',
  });
  assert.equal(config.command, 'npx');
  assert.deepEqual(config.args, ['-y', '@example/files-mcp@1.2.0', '/data', '--mode', 'read']);
  assert.deepEqual(config.env, { LOG_LEVEL: 'info' });
  assert.deepEqual(config.secretEnv, ['API_KEY']);
  assert.deepEqual(secrets, { 'env.API_KEY': 'sk-123' });
  assert.ok(!JSON.stringify(config).includes('sk-123'));
});

test('required fields are enforced', () => {
  assert.throws(() => buildServer('official', npmServer, 'package:0', {}), /required/);
});

test('remote header placeholders are filled and stored as secrets', () => {
  const remote = {
    name: 'io.example/remote',
    version: '0.1.0',
    remotes: [
      {
        type: 'streamable-http',
        url: 'https://{tenant}.example.com/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer {token}', isSecret: true }],
      },
    ],
  };
  const [option] = installOptions(remote);
  assert.deepEqual(
    option?.fields.map((field) => field.key),
    ['url.tenant', 'header.Authorization.token'],
  );
  const { config, secrets } = buildServer('github', remote, 'remote:0', {
    'url.tenant': 'acme',
    'header.Authorization.token': 'abc',
  });
  assert.equal(config.url, 'https://acme.example.com/mcp');
  assert.equal(config.transport, 'http');
  assert.deepEqual(config.secretHeaders, ['Authorization']);
  assert.deepEqual(secrets, { 'header.Authorization': 'Bearer abc' });
});
