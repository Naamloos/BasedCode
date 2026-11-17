import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { DefineTool, ToolContext, ToolServices } from './definitions.js';
import { createVisualTools } from './visualTools.js';

const definition: DefineTool = (name, description, shape, handler) => ({
  name, description, shape,
  execute: input => handler(z.object(shape).parse(input), () => {}),
});
const suggest = createVisualTools({} as ToolContext, {} as ToolServices, definition)
  .find(tool => tool.name === 'suggest_prompts')!;
const item = (label: string, action = 'send') => ({ label, prompt: `Do ${label}`, action });

test('suggest_prompts accepts 1 to 3 labelled send or draft suggestions', async () => {
  assert.deepEqual(await suggest.execute({ suggestions: [item('Run tests'), item('Edit', 'draft')] }), { suggested: 2 });
  await assert.rejects(suggest.execute({ suggestions: [] }));
  await assert.rejects(suggest.execute({ suggestions: [item('a'), item('b'), item('c'), item('d')] }));
  await assert.rejects(suggest.execute({ suggestions: [item('x'.repeat(61))] }));
  await assert.rejects(suggest.execute({ suggestions: [item('Go', 'run')] }));
  await assert.rejects(suggest.execute({ suggestions: [{ label: 'Go', prompt: '  ', action: 'send' }] }));
  await assert.rejects(suggest.execute({ suggestions: [item('Run tests'), item('run TESTS')] }), /different label/);
});
