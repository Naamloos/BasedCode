import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { answerAsyncQuery, answerQuery, createQueryTools } from './queryTools.js';
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

test('async questions return immediately, accept one answer, and close on abort', async () => {
  const controller = new AbortController();
  let canSteer = false;
  const context = {
    run: { id: 'async-question-run' },
    signal: controller.signal,
    canSteer: () => canSteer,
  } as ToolContext;
  const definition: DefineTool = (name, description, shape, handler) => ({
    name, description, shape,
    execute: async (input) => handler(z.object(shape).parse(input), () => undefined),
  });
  const ask = createQueryTools(context, definition).find(({ name }) => name === 'query_async')!;
  const input = { question: 'Which layout?' };
  await assert.rejects(ask.execute(input), /Live steering is unavailable/);
  canSteer = true;
  const { queryId } = await ask.execute(input) as { queryId: string };
  await assert.rejects(ask.execute(input), /already has a pending question/);
  const replies: string[] = [];
  const deliver = (answer: string) => { replies.push(answer); };
  assert.throws(() => answerAsyncQuery('another-run', queryId, 'Grid', deliver), /no longer active/);
  assert.throws(() => answerAsyncQuery(context.run.id, queryId, 'Grid', () => {
    throw new Error('Steering unavailable');
  }), /Steering unavailable/);
  assert.equal(answerAsyncQuery(context.run.id, queryId, ' Grid ', deliver), 'Grid');
  assert.deepEqual(replies, ['Grid']);
  assert.throws(() => answerAsyncQuery(context.run.id, queryId, 'List', deliver), /no longer active/);

  await assert.rejects(ask.execute({ ...input, options: ['Grid'] }), /at least|>=2/);
  const choice = await ask.execute({ ...input, options: ['Grid', 'List'] }) as { queryId: string };
  assert.equal(answerAsyncQuery(context.run.id, choice.queryId, 'List', deliver), 'List');
  const next = await ask.execute(input) as { queryId: string };
  controller.abort();
  assert.throws(() => answerAsyncQuery(context.run.id, next.queryId, 'List', deliver), /no longer active/);
});

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
  const result = tools.find(({ name }) => name === 'query_text')!.execute({ question: 'Name?' });
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
