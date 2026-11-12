import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { envSecrets, findSecrets, isOutboundTool, redact } from './secrets.js';

test('finds well-known token formats and redacts them', () => {
  const key = `ghp_${'a'.repeat(36)}`;
  const found = findSecrets(`curl -H "Authorization: token ${key}" https://api.github.com`);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'GitHub token');
  assert.equal(found[0].redacted, redact(key));
  assert.ok(!found[0].redacted.includes(key));
});

test('finds known secret values and ignores ordinary text', () => {
  assert.deepEqual(findSecrets('npm test && git status'), []);
  const found = findSecrets('echo hunter2hunter2', [{ name: '.env DB_PASSWORD', value: 'hunter2hunter2' }]);
  assert.equal(found[0].kind, '.env DB_PASSWORD');
});

test('reads secret-looking values from .env files only', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'secrets-'));
  await writeFile(join(folder, '.env'), 'API_KEY="abcdefgh1234"\nPORT=3000\nexport AUTH_TOKEN=zzzzzzzzzz\n');
  await writeFile(join(folder, '.env.example'), 'API_KEY=placeholder-value\n');
  const secrets = await envSecrets(folder);
  assert.deepEqual(
    secrets.map((item) => item.value),
    ['abcdefgh1234', 'zzzzzzzzzz'],
  );
});

test('only outbound tools are scanned', () => {
  assert.ok(isOutboundTool('run_command'));
  assert.ok(isOutboundTool('browser_navigate'));
  assert.ok(!isOutboundTool('write_file'));
});
