import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import type { DefineTool, ToolContext, ToolServices } from './definitions.js';
import { createFileTools } from './fileTools.js';

async function setup(files: Record<string, string>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'basedcode-files-')));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), content);
  }
  const definition: DefineTool = (name, description, shape, handler) => ({
    name,
    description,
    shape,
    execute: (input) => handler(z.object(shape).strict().parse(input), () => undefined),
  });
  const services = {
    events: { publish: () => undefined },
    languages: { changed: async () => undefined, diagnosticsAfterWrite: async () => undefined },
  } as unknown as ToolServices;
  const context = {
    workspace: { id: 'w', path: root },
    run: { id: 'r' },
    signal: new AbortController().signal,
  } as unknown as ToolContext;
  const tools = createFileTools(context, services, definition);
  return {
    root,
    run: (name: string, args: Record<string, unknown>) =>
      tools.find((tool) => tool.name === name)!.execute(args),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('reads, searches and listings come back as compact text', async () => {
  const { run, cleanup } = await setup({
    'src/a.ts': 'const one = 1;\nexport function two() {}\nconst three = one;\n',
    'src/deep/b.ts': 'export const ONE = 1;\n',
    'notes.md': '# Notes\n',
  });
  try {
    assert.equal(
      await run('read_file', { path: 'src/a.ts', lines: 2 }),
      'src/a.ts lines 1-2 of 4 · more: startLine 3\n1: const one = 1;\n2: export function two() {}',
    );
    assert.equal(
      await run('read_file', { path: 'src/a.ts', find: 'three' }),
      'src/a.ts lines 1-4 of 4 · match on 3\n1: const one = 1;\n2: export function two() {}\n3: const three = one;\n4: ',
    );
    assert.equal(
      await run('search', { query: 'one', path: 'src' }),
      'src/a.ts\n  1: const one = 1;\n  3: const three = one;\nsrc/deep/b.ts\n  1: export const ONE = 1;',
    );
    assert.equal(await run('search', { query: 'one', output: 'files' }), 'src/a.ts\nsrc/deep/b.ts');
    assert.equal(
      await run('search', { query: 'one', output: 'count', caseSensitive: true }),
      'src/a.ts: 2\n2 matches in 1 files',
    );
    assert.match(String(await run('search', { query: 'one', maxResults: 1 })), /Stopped at the limit/);
    assert.equal(await run('search', { query: 'absent' }), 'No matches.');
    assert.equal(await run('find_files', { pattern: '**/*.ts' }), 'src/a.ts\nsrc/deep/b.ts');
    assert.equal(await run('list_files', { depth: 3 }), 'src/\n deep/\n  b.ts\n a.ts\nnotes.md');
    assert.equal(await run('list_files', { path: 'src' }), 'deep/\na.ts');
    assert.match(String(await run('read_files', { paths: ['notes.md', 'missing.md'] })), /^notes\.md lines 1-2 of 2\n1: # Notes\n2: \n\nmissing\.md: ERROR /);
    assert.equal(
      await run('file_outline', { paths: ['src/a.ts'] }),
      'src/a.ts (4 lines)\n1: const one = 1;\n2: export function two() {}\n3: const three = one;',
    );
  } finally {
    await cleanup();
  }
});

test('edit_lines replaces ranges by number, bottom-up, and refuses stale line numbers', async () => {
  const { run, root, cleanup } = await setup({ 'a.txt': 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n' });
  try {
    await assert.rejects(
      run('edit_lines', { path: 'a.txt', edits: [{ startLine: 2, expect: 'three', content: 'x' }] }),
      /expect was not found on that line, which reads: "two"/,
    );
    await assert.rejects(
      run('edit_lines', {
        path: 'a.txt',
        edits: [
          { startLine: 1, endLine: 2, expect: 'one', content: 'x' },
          { startLine: 2, expect: 'two', content: 'y' },
        ],
      }),
      /overlaps/,
    );
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n');
    const result = await run('edit_lines', {
      path: 'a.txt',
      edits: [
        { startLine: 4, expect: 'four', content: '' },
        { startLine: 1, endLine: 2, expect: 'one', content: 'ONE\nTWO\nTWO-B\n' },
      ],
    });
    assert.deepEqual(result, { path: 'a.txt', edited: 2, totalLines: 6 });
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'ONE\r\nTWO\r\nTWO-B\r\nthree\r\nfive\r\n');
  } finally {
    await cleanup();
  }
});
