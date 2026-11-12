import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { compactObservation } from '../agent/context.js';
import { extractDocument, htmlText, parseRange, rtfText } from './documents.js';

const noImages = { includeImages: false, maxImages: 4 };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

test('extracts Word paragraphs, tables and images', async () => {
  const bytes = zipSync({
    'word/document.xml': strToU8(
      '<w:document><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '</w:body></w:document>',
    ),
    'word/media/image1.png': png,
  });
  const result = await extractDocument(bytes, 'report.docx', { includeImages: true, maxImages: 4 });
  assert.match(result.text, /Hello & welcome/);
  assert.match(result.text, /A\s*\|\s*\n?\s*B/);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].mediaType, 'image/png');
});

test('extracts Excel cells with shared strings and sheet names', async () => {
  const bytes = zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8('<sst><si><t>Item</t></si><si><t>Cost</t></si></sst>'),
    'xl/worksheets/sheet1.xml': strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Rent</t></is></c><c r="C2"><v>1200</v></c></row></sheetData></worksheet>',
    ),
    'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData/></worksheet>'),
  });
  const result = await extractDocument(bytes, 'book.xlsx', { ...noImages, range: { from: 1, to: 1 } });
  assert.equal(result.parts, 2);
  assert.match(result.text, /Sheet 1: Budget/);
  assert.match(result.text, /1\tItem\t\tCost/);
  assert.match(result.text, /2\tRent\t\t1200/);
  assert.doesNotMatch(result.text, /Other/);
});

test('extracts slides in numeric order with notes', async () => {
  const slide = (text: string) => strToU8(`<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
  const bytes = zipSync({
    'ppt/slides/slide10.xml': slide('Ten'),
    'ppt/slides/slide2.xml': slide('Two'),
    'ppt/notesSlides/notesSlide2.xml': slide('Speaker note'),
  });
  const result = await extractDocument(bytes, 'deck.pptx', noImages);
  assert.ok(result.text.indexOf('Two') < result.text.indexOf('Ten'));
  assert.match(result.text, /Notes:\nSpeaker note/);
});

test('plain-text formats and ranges', () => {
  assert.equal(htmlText('<html><body><p>One</p><script>x()</script><p>Two&nbsp;!</p></body></html>'), 'One\nTwo !');
  assert.equal(rtfText('{\\rtf1{\\fonttbl{\\f0 Arial;}}\\f0 Hello\\par World}'), 'Hello\nWorld');
  assert.deepEqual(parseRange('2-5'), { from: 2, to: 5 });
  assert.throws(() => parseRange('5-2'));
});

test('earlier tool observations are trimmed harder than current ones', () => {
  const tool = { name: 'read_file', status: 'completed', args: { content: 'x'.repeat(5000) }, result: 'y'.repeat(50_000) };
  const earlier = compactObservation(tool, false);
  const current = compactObservation(tool, true);
  assert.ok(earlier.length < 2_000);
  assert.ok(current.length > earlier.length && current.length < 16_000);
  assert.match(earlier, /more characters omitted/);
});
