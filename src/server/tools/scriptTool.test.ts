import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Store } from '../storage/store.js';
import type { ToolDefinition } from './definitions.js';
import { runScript } from './scriptTool.js';

const directory = mkdtempSync(join(tmpdir(), 'basedcode-script-'));
const store = new Store(join(directory, 'test.sqlite'));
after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});

const calls: string[] = [];
const tools: ToolDefinition[] = [
  {
    name: 'echo',
    description: 'Returns its arguments.',
    shape: {},
    execute: async (args) => {
      calls.push(JSON.stringify(args));
      return { echoed: args };
    },
  },
  {
    name: 'fail',
    description: 'Always fails.',
    shape: {},
    execute: async () => {
      throw new Error('denied by the user');
    },
  },
];
const run = (code: string) =>
  runScript(code, { tools, store, chatId: 'chat-1', signal: new AbortController().signal });

test('a script calls tools, in parallel too, and returns a value', async () => {
  calls.length = 0;
  const outcome = await run(`
    const [a, b] = await Promise.all([tools.echo({ n: 1 }), tools.echo({ n: 2 })]);
    text('sum', a.echoed.n + b.echoed.n);
    return ALL_TOOLS.map((tool) => tool.name);
  `);
  assert.deepEqual(outcome.result, ['echo', 'fail']);
  assert.equal(outcome.output, 'sum 3');
  assert.equal(outcome.toolCalls, 2);
  assert.equal(calls.length, 2);
});

test('a failed tool call throws inside the script and can be caught', async () => {
  const outcome = await run(`
    try { await tools.fail(); } catch (error) { return String(error.message); }
  `);
  assert.match(String(outcome.result), /denied by the user/);
});

test('an uncaught error fails the script with its output so far', async () => {
  await assert.rejects(run(`text('before'); await tools.fail();`), /Script error:.*denied[\s\S]*before/);
});

test('unknown and excluded tools are refused', async () => {
  await assert.rejects(run(`await tools.run_script({ code: '1' })`), /cannot be called from a script/);
  await assert.rejects(run(`await tools.nope()`), /No tool named "nope"/);
});

test('store and load keep values across scripts in the same chat', async () => {
  await run(`store('count', { value: 41 })`);
  const outcome = await run(`return load('count').value + 1`);
  assert.equal(outcome.result, 42);
  const other = await runScript(`return load('count') ?? null`, {
    tools,
    store,
    chatId: 'chat-2',
    signal: new AbortController().signal,
  });
  assert.equal(other.result, null);
});

test('the sandbox has no Node or host access', async () => {
  const outcome = await run(`
    return [
      typeof process,
      typeof require,
      typeof setTimeout,
      typeof fetch,
      (() => { try { return typeof tools.echo.constructor('return process')(); } catch { return 'blocked'; } })(),
    ];
  `);
  const [processType, requireType, timerType, fetchType, escaped] = outcome.result as string[];
  assert.deepEqual([processType, requireType, timerType, fetchType], ['undefined', 'undefined', 'undefined', 'undefined']);
  // The function-constructor escape either throws or finds no process inside the sandbox; both are safe.
  assert.ok(['undefined', 'blocked'].includes(escaped));
});

// A blocking loop never yields to the event loop, so an abort timer cannot fire; the time slice limit stops it.
test('an endless loop is interrupted by the time slice limit', { timeout: 30_000 }, async () => {
  await assert.rejects(run('while (true) {}'), /interrupted/i);
});
