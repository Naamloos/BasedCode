import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMatches,
  headTail,
  htmlToText,
  numberedLines,
  outline,
  pathTree,
  readHeader,
  squeezeLines,
} from './textResults.js';

test('numbered reads stop at the line count or the character budget and always make progress', () => {
  const lines = ['one', 'two', 'three', 'four'];
  assert.deepEqual(numberedLines(lines, 2, 2), { text: '2: two\n3: three', endLine: 3 });
  assert.equal(numberedLines(lines, 1, 10, 14).endLine, 2);
  assert.equal(numberedLines(['x'.repeat(50)], 1, 10, 5).endLine, 1);
  assert.match(numberedLines(['x'.repeat(5_000)], 1, 1).text, /\[\+4000 chars\]$/);
  assert.equal(readHeader('a.ts', 1, 2, 4), 'a.ts lines 1-2 of 4 · more: startLine 3');
  assert.equal(readHeader('a.ts', 3, 4, 4, 3), 'a.ts lines 3-4 of 4 · match on 3');
});

test('search matches are grouped per file, with context hunks separated', () => {
  const lines = ['a', '  hit one', 'c', 'd', 'e', 'f', 'hit two', 'h'];
  const file = { path: 'src/a.ts', lines, matches: [1, 6] };
  assert.equal(formatMatches([file], 0), 'src/a.ts\n  2: hit one\n  7: hit two');
  assert.equal(
    formatMatches([file], 1),
    'src/a.ts\n  1- a\n  2:   hit one\n  3- c\n  --\n  6- f\n  7: hit two\n  8- h',
  );
});

test('listings write each directory name once', () => {
  const entries = [
    { path: 'src/tools', directory: true },
    { path: 'src/tools/a.ts', directory: false },
    { path: 'src/main.ts', directory: false },
  ];
  assert.equal(pathTree(entries, 'src'), 'tools/\n a.ts\nmain.ts');
  assert.equal(pathTree([{ path: 'src', directory: true }], '.'), 'src/');
});

test('outline finds declarations and skips control flow', () => {
  const source = [
    "import x from 'y';",
    'export class Agent {',
    '  private async run(id: string): Promise<void> {',
    '    if (id) {',
    '      return;',
    '    }',
    '  }',
    '}',
    'export const limit = 3;',
    'const helper = (value: number) => value * 2;',
    'function plain() {}',
  ].join('\n');
  const result = outline(source, 'agent.ts');
  assert.equal(
    result,
    [
      'agent.ts (11 lines)',
      '2: export class Agent {',
      '3:   private async run(id: string): Promise<void> {',
      '9: export const limit = 3;',
      '10: const helper = (value: number) => value * 2;',
      '11: function plain() {}',
    ].join('\n'),
  );
  assert.match(outline('def run(self):\n    pass\nclass A:\n', 'a.py'), /1: def run.*\n3: class A:/);
  assert.equal(outline('# Title\n```\n# not a heading\n```\n## Part', 'a.md'), 'a.md (5 lines)\n1: # Title\n5: ## Part');
});

test('command output keeps its head and tail and drops repeated lines', () => {
  const cut = headTail('a'.repeat(100) + 'b'.repeat(100), 40);
  assert.ok(cut.startsWith('a'.repeat(10)) && cut.endsWith('b'.repeat(30)));
  assert.match(cut, /160 characters omitted/);
  assert.equal(headTail('short', 40), 'short');
  assert.equal(
    squeezeLines('x\nx\nx\nx\ny\ny\n\n\n\nz'),
    'x\n[previous line repeated 3 more times]\ny\ny\n\nz',
  );
});

test('html becomes readable text without scripts, chrome or markup', () => {
  const html = `<html><head><title>T</title><style>p{}</style></head><body>
    <nav><a href="/x">Menu</a></nav>
    <h1>Guide</h1><p>Use <code>a &amp; b</code> &#8212; see <a href="https://example.com/docs">the docs</a>.</p>
    <ul><li>One</li><li>Two</li></ul><pre>line 1
line 2</pre><script>alert(1)</script></body></html>`;
  assert.equal(
    htmlToText(html),
    '# Guide\nUse a & b — see the docs (https://example.com/docs).\n\n- One\n- Two\n\n```\nline 1\nline 2\n```',
  );
});
