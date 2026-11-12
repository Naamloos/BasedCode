import assert from 'node:assert/strict';
import { previewMediaType } from './preview.js';

assert.equal(previewMediaType('images/PHOTO.PNG'), 'image/png');
assert.equal(previewMediaType('audio/song.mp3'), 'audio/mpeg');
assert.equal(previewMediaType('video/clip.webm'), 'video/webm');
assert.equal(previewMediaType('documents/manual.pdf'), 'application/pdf');
for (const path of ['page.html', 'page.htm', 'page.xhtml', 'page.HTML', 'notes.md', 'archive.zip']) {
  assert.equal(previewMediaType(path), undefined);
}
