import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { ToolDefinition } from './definitions.js';
import { inputSchema } from './definitions.js';
import { deferTools, toolGroups } from './deferred.js';

function fake(name: string, calls: unknown[] = []): ToolDefinition {
  const shape = { path: z.string() };
  return {
    name,
    description: `About ${name}.`,
    shape,
    execute: async (input) => {
      calls.push([name, z.object(shape).strict().parse(input)]);
      return `${name} ran`;
    },
  };
}

test('rarely used groups leave the offered tools and stay reachable through call_tool', async () => {
  const calls: unknown[] = [];
  const names = ['read_file', 'search', ...toolGroups.browser.tools, ...toolGroups.git_write.tools];
  const { offered, catalog } = deferTools(
    names.map((name) => fake(name, calls)),
    () => false,
  );
  assert.deepEqual(
    offered.map((tool) => tool.name),
    ['read_file', 'search', 'load_tools', 'call_tool'],
  );
  assert.match(catalog, /- browser \(.*\): browser_navigate, /);
  assert.ok(!catalog.includes('mcp'), 'groups without tools are not advertised');

  const load = offered.find((tool) => tool.name === 'load_tools')!;
  const loaded = String(await load.execute({ group: 'git_write' }));
  assert.match(loaded, /## git_commit\nAbout git_commit\.\nargs: \{"type":"object","properties":\{"path"/);
  assert.ok(!loaded.includes('$schema'));

  const call = offered.find((tool) => tool.name === 'call_tool')!;
  assert.equal(await call.execute({ name: 'git_commit', args: { path: 'a' } }), 'git_commit ran');
  assert.deepEqual(calls, [['git_commit', { path: 'a' }]]);
  await assert.rejects(call.execute({ name: 'git_commit', args: {} }), /Invalid arguments.*\n[\s\S]*## git_commit/);
  await assert.rejects(call.execute({ name: 'read_file', args: {} }), /call it directly/);
  await assert.rejects(call.execute({ name: 'nope', args: {} }), /No extra tool/);
});

test('kept tools stay loaded, and too few deferred tools change nothing', () => {
  const definitions = ['read_file', ...toolGroups.design.tools].map((name) => fake(name));
  const kept = deferTools(definitions, (name) => name !== 'query_slider');
  assert.equal(kept.offered, definitions);
  assert.equal(kept.catalog, '');

  const some = deferTools(
    [...definitions, ...toolGroups.visuals.tools.map((name) => fake(name))],
    (name) => name === 'query_color',
  );
  assert.ok(some.offered.some((tool) => tool.name === 'query_color'));
  assert.ok(!some.offered.some((tool) => tool.name === 'query_font'));
});

test('the proxy tools use no schema keyword that makes Claude Code drop the whole tool list', () => {
  const { offered } = deferTools(
    [...toolGroups.browser.tools, 'read_file'].map((name) => fake(name)),
    () => false,
  );
  for (const tool of offered)
    assert.ok(
      !JSON.stringify(z.toJSONSchema(inputSchema(tool.shape))).includes('propertyNames'),
      `${tool.name} must not use z.record`,
    );
});
