import assert from 'node:assert/strict';
import { test } from 'node:test';
import { languageId } from './languages.js';

test('languageId maps extensions to LSP language IDs', () => {
  assert.equal(languageId('src/main.go'), 'go');
  assert.equal(languageId('src/lib.RS'), 'rust');
  assert.equal(languageId('include/widget.hpp'), 'cpp');
  assert.equal(languageId('styles/site.scss'), 'scss');
  assert.equal(languageId('.github/workflows/ci.yml'), 'yaml');
  assert.equal(languageId('scripts/build.sh'), 'shellscript');
  assert.equal(languageId('notes.txt'), 'plaintext');
});

test('languageId recognises Dockerfiles by name', () => {
  assert.equal(languageId('Dockerfile'), 'dockerfile');
  assert.equal(languageId('docker/Dockerfile.dev'), 'dockerfile');
  assert.equal(languageId('Containerfile'), 'dockerfile');
  assert.equal(languageId('api.dockerfile'), 'dockerfile');
  assert.equal(languageId('dockerfiles.md'), 'markdown');
});
