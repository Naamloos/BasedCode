import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newerVersion, Updates } from './updates.js';

test('newerVersion compares numeric parts and pre-releases', () => {
  assert.equal(newerVersion('0.2.0', '0.1.0'), true);
  assert.equal(newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(newerVersion('v1.0.0', '1.0.0'), false);
  assert.equal(newerVersion('0.9.0', '1.0.0'), false);
  assert.equal(newerVersion('1.0.0', '1.0.0-beta.1'), true);
  assert.equal(newerVersion('1.0.0-beta.1', '1.0.0'), false);
  assert.equal(newerVersion('0.0.1-alpha-2', '0.0.1-alpha-1'), true);
  assert.equal(newerVersion('0.0.1-alpha-1', '0.0.1-alpha-2'), false);
  assert.equal(newerVersion('0.0.1-alpha-10', '0.0.1-alpha-9'), true);
});

test('update checks fall back to the public release when the API is rate limited', async (context) => {
  const updates = new Updates(() => {});
  Object.defineProperty(updates, 'supported', { value: true });
  context.mock.method(updates, 'current', async () => '1.0.0');
  const notesUrl = 'https://github.com/Naamloos/BasedCode/releases/tag/v1.2.1';
  const downloadUrl =
    'https://github.com/Naamloos/BasedCode/releases/download/v1.2.1/BasedCode-Setup-1.2.1.exe';
  const page = new Response('release page');
  Object.defineProperty(page, 'url', { value: notesUrl });
  context.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url === 'https://api.github.com/repos/Naamloos/BasedCode/releases/latest')
      return new Response('{"message":"API rate limit exceeded"}', { status: 403 });
    if (url === 'https://github.com/Naamloos/BasedCode/releases/latest') return page;
    assert.equal(url, downloadUrl);
    assert.equal(options?.method, 'HEAD');
    return new Response(null, { headers: { 'content-length': '1234' } });
  });

  assert.deepEqual(await updates.check(), {
    supported: true,
    current: '1.0.0',
    latest: '1.2.1',
    available: true,
    notesUrl,
  });
});
