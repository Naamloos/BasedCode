import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexHome, codexConfig } from './codexHome.js';

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'basedcode-codex-'));
  const source = join(base, 'user-codex');
  await mkdir(source);
  const home = new CodexHome(join(base, 'private'), source);
  return { base, source, home, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('private home copies only auth.json and never user-level instructions', async () => {
  const { source, home, cleanup } = await setup();
  try {
    await writeFile(join(source, 'auth.json'), '{"token":"a"}');
    await writeFile(join(source, 'config.toml'), '[plugins.evil]\nenabled = true\n');
    await writeFile(join(source, 'AGENTS.md'), 'global instructions');
    const prepared = await home.prepare(codexConfig(['shell_tool']));
    assert.ok(prepared);
    assert.equal(await readFile(join(prepared.home, 'auth.json'), 'utf8'), '{"token":"a"}');
    assert.match(await readFile(join(prepared.home, 'config.toml'), 'utf8'), /shell_tool = false/);
    assert.doesNotMatch(await readFile(join(prepared.home, 'config.toml'), 'utf8'), /evil/);
    assert.equal(existsSync(join(prepared.home, 'AGENTS.md')), false);
    // A stray AGENTS.md planted in the private home is removed on the next prepare.
    await writeFile(join(prepared.home, 'AGENTS.md'), 'planted');
    await home.prepare('');
    assert.equal(existsSync(join(prepared.home, 'AGENTS.md')), false);
  } finally { await cleanup(); }
});

test('refreshed tokens sync back unless the user login changed meanwhile', async () => {
  const { source, home, cleanup } = await setup();
  try {
    await writeFile(join(source, 'auth.json'), 'v1');
    let prepared = (await home.prepare(''))!;
    await writeFile(join(prepared.home, 'auth.json'), 'v2-refreshed');
    await prepared.finish();
    assert.equal(await readFile(join(source, 'auth.json'), 'utf8'), 'v2-refreshed');

    prepared = (await home.prepare(''))!;
    await writeFile(join(prepared.home, 'auth.json'), 'v3-refreshed');
    await writeFile(join(source, 'auth.json'), 'user re-logged in');
    await prepared.finish();
    assert.equal(await readFile(join(source, 'auth.json'), 'utf8'), 'user re-logged in');
  } finally { await cleanup(); }
});

test('no auth.json means no private home (caller falls back and warns)', async () => {
  const { home, cleanup } = await setup();
  try { assert.equal(await home.prepare(''), undefined); } finally { await cleanup(); }
});
