import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { inlineUiDocument } from './inlineUi.js';
import { libraryFile, libraryTags, widgetLibraries, widgetLibraryNames } from './widgetLibraries.js';

const origin = 'http://127.0.0.1:1234';

function urls(tags: string): string[] {
  return [...tags.matchAll(/http:\/\/127\.0\.0\.1:1234(\/views\/lib\/[^"]+)/g)].map((match) => match[1]);
}

test('every bundled library resolves to a real served file', () => {
  for (const name of widgetLibraryNames) {
    const paths = urls(libraryTags([name], origin));
    assert.ok(paths.length, `${name} emits tags`);
    for (const path of paths) {
      // Directory import-map entries end with "/"; check a known file inside instead.
      const probe = path.endsWith('/') ? `${path}controls/OrbitControls.js` : path;
      const file = libraryFile(probe);
      assert.ok(file && existsSync(file), `${name}: ${probe}`);
    }
  }
});

test('three uses an import map; script libraries use classic tags; unknown names are ignored', () => {
  const tags = libraryTags(['three', 'matter', 'bogus'], origin);
  assert.match(tags, /<script type="importmap">.*"three":/);
  assert.match(tags, /three\/addons\//);
  assert.match(tags, /<script src="[^"]+matter\.min\.js"><\/script>/);
  assert.doesNotMatch(tags, /bogus/);
  assert.equal(libraryTags([], origin), '');
});

test('the file route only serves allowlisted files of the installed version', () => {
  const three = libraryTags(['three'], origin);
  const version = /three@([^/]+)\//.exec(three)![1];
  assert.ok(libraryFile(`/views/lib/three@${version}/build/three.core.js`));
  assert.equal(libraryFile(`/views/lib/three@${version}/package.json`), undefined);
  assert.equal(libraryFile(`/views/lib/three@${version}/examples/jsm/../../package.json`), undefined);
  assert.equal(libraryFile(`/views/lib/three@0.0.0/build/three.module.js`), undefined);
  assert.equal(libraryFile(`/views/lib/left-pad@1.0.0/index.js`), undefined);
  assert.ok(Object.keys(widgetLibraries).includes('tone'));
});

test('attached files are exposed as basedcode.files before widget code, with script terminators escaped', () => {
  const html = inlineUiDocument('<p id="mine">hi</p>', [], origin, { '</script>.wad': 'http://x/views/files/v/f' });
  const map = html.indexOf('window.basedcode.files=');
  assert.ok(html.indexOf('window.basedcode =') < map && map < html.indexOf('id="mine"'));
  assert.ok(html.includes('\\u003c/script>.wad'));
  assert.doesNotMatch(inlineUiDocument('x'), /basedcode\.files/);
});

test('library tags are injected after the bridge and before widget code', () => {
  const html = inlineUiDocument('<p id="mine">hi</p>', ['confetti'], origin);
  assert.ok(html.indexOf('window.basedcode') < html.indexOf('confetti.browser.js'));
  assert.ok(html.indexOf('confetti.browser.js') < html.indexOf('id="mine"'));
});
