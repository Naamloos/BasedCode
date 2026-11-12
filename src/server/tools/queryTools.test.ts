import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { answerQuery, createQueryTools } from './queryTools.js';
import type { DefineTool, ToolContext } from './definitions.js';
import { queryDocument } from './queryUi.js';

function setup() {
  const controller = new AbortController();
  let queryId = '';
  const definition: DefineTool = (name, description, shape, handler) => ({
    name, description, shape,
    execute: input => handler(z.object(shape).parse(input), result => {
      queryId = (result as { queryId: string }).queryId;
    }),
  });
  const tools = createQueryTools({ signal: controller.signal } as ToolContext, definition);
  return { controller, tools, id: () => queryId };
}

test('queries validate answers, complete once, and reject duplicate submissions', async () => {
  const { tools, id } = setup();
  const result = tools.find(tool => tool.name === 'query_yes_no')!.execute({ question: 'Continue?' });
  assert.throws(() => answerQuery(id(), 'yes'));
  answerQuery(id(), false);
  assert.deepEqual(await result, { answer: false });
  assert.throws(() => answerQuery(id(), true), /no longer active/);
});

test('cancelling a query removes its pending answer handler', async () => {
  const { tools, controller, id } = setup();
  const result = tools[0].execute({ question: 'Name?' });
  controller.abort();
  await assert.rejects(result, /cancelled/);
  assert.throws(() => answerQuery(id(), 'late'), /no longer active/);
});

test('slider checks range and step before accepting an answer', async () => {
  const { tools, id } = setup();
  const slider = tools.find(tool => tool.name === 'query_slider')!;
  await assert.rejects(slider.execute({ question: 'Value?', min: 10, max: 0 }), /Invalid slider/);
  const result = slider.execute({ question: 'Value?', min: 0, max: 10, step: 2 });
  assert.throws(() => answerQuery(id(), 3), /step/);
  answerQuery(id(), 4);
  assert.deepEqual(await result, { answer: 4 });
});

test('choice rendering escapes question text and script terminators in options', () => {
  const html = queryDocument('query_choice', { question: '<script>bad()</script>', options: ['</script><script>bad()</script>', 'Other'] });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('Custom answer'));
});

test('preview choice embeds the preview, escapes options and returns the picked label', async () => {
  const options = [{ label: '</script><b>Dark</b>', value: { bg: '#000' } }, { label: 'Light' }];
  const html = queryDocument('query_preview', { question: 'Theme?', options, preview: '<div id="swatch"></div><script>basedcode.onPreview(v => {})</script>' });
  assert.ok(html.includes('<div id="swatch"></div>'));
  assert.ok(html.includes('&lt;/script&gt;&lt;b&gt;Dark'));
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(html.includes('"value":"Light"'));
  const { tools, id } = setup();
  const result = tools.find(tool => tool.name === 'query_preview')!.execute({ question: 'Theme?', options, preview: '<p></p>' });
  answerQuery(id(), 'Light');
  assert.deepEqual(await result, { answer: 'Light' });
});
