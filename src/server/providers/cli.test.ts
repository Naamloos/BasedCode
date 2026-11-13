import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cliPath } from './cli.js';

test('Codex detection never falls back to a bundled CLI', {
  skip: process.platform !== 'win32',
}, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'basedcode-cli-'));
  const previous = process.env.PATH;
  try {
    await writeFile(join(folder, 'codex.cmd'), '@echo off\r\n');
    process.env.PATH = folder;
    for (const [kind, command] of [
      ['codex', 'codex'],
      ['claude', 'claude'],
      ['antigravity', 'agy'],
    ] as const) {
      const executable = join(folder, `${command}.exe`);
      await writeFile(executable, '');
      assert.equal(cliPath(kind), executable);
      await rm(executable);
    }
    assert.throws(() => cliPath('codex'), /Cannot resolve codex launcher/);
    process.env.PATH = '';
    assert.throws(() => cliPath('codex'), /Codex was not found on PATH/);
    assert.throws(() => cliPath('codex', join(folder, 'codex.cmd')), /Cannot resolve codex launcher/);
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
    await rm(folder, { recursive: true, force: true });
  }
});
