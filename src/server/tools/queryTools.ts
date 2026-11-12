import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DefineTool, ToolContext, ToolDefinition } from './definitions.js';
import { fontNamePattern, hexColorPattern } from './designPickers.js';
import { libraryUsage, widgetLibraryNames } from './widgetLibraries.js';

/** Shared by render_ui and query_ui: chat attachments a widget may load (e.g. a .wasm engine or a game data file). */
export const filesField = z
  .array(z.string().uuid())
  .max(20)
  .optional()
  .describe(
    'Attachment ids from this chat the widget may load. They appear as basedcode.files["name.ext"] = URL; use fetch(url), WebAssembly.instantiateStreaming(fetch(url)) or <script src>. Only files the user attached to this chat work.',
  );

/** Shared by render_ui and query_ui. */
export const librariesField = z
  .array(z.enum(widgetLibraryNames))
  .max(widgetLibraryNames.length)
  .optional()
  .describe(`Bundled libraries to load (served locally, loaded before your code runs):\n${libraryUsage()}`);

const pending = new Map<string, { answer: (value: unknown) => void }>();

export function answerQuery(queryId: string, value: unknown): void {
  const query = pending.get(queryId);
  if (!query) throw new Error('This query is no longer active.');
  query.answer(value);
}

export function createQueryTools(context: ToolContext, definition: DefineTool): ToolDefinition[] {
  const wait = (
    validate: (value: unknown) => unknown,
    progress: (result: unknown) => void,
  ): Promise<unknown> => new Promise((resolve, reject) => {
    const queryId = randomUUID();
    const cleanup = () => {
      pending.delete(queryId);
      context.signal.removeEventListener('abort', abort);
    };
    const abort = () => { cleanup(); reject(new Error('Query cancelled.')); };
    pending.set(queryId, { answer: (value) => {
      const answer = validate(value);
      cleanup();
      resolve({ answer });
    } });
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) { abort(); return; }
    progress({ queryId });
  });
  const question = z.string().min(1).max(1000);
  return [
    definition('query_text', 'Ask an in-chat text question and wait for the answer. The answered query stays visible and inactive.',
      { question, placeholder: z.string().max(300).optional() },
      async (_args, progress) => wait(value => z.string().trim().min(1).max(20000).parse(value), progress)),
    definition('query_yes_no', 'Ask an in-chat yes/no question and wait for a boolean answer.',
      { question },
      async (_args, progress) => wait(value => z.boolean().parse(value), progress)),
    definition('query_choice', 'Ask an in-chat multiple choice question. Users can select one option or enter a custom answer.',
      { question, options: z.array(z.string().min(1).max(300)).min(2).max(30) },
      async (_args, progress) => wait(value => z.string().trim().min(1).max(20000).parse(value), progress)),
    definition('query_preview', 'Ask a multiple choice question with a live preview: the option the user selects is rendered in your small HTML/CSS/JS preview, and they confirm with Submit. In preview, register basedcode.onPreview((value, option) => { ... }) and update the DOM; value is the option\'s value (or its label), option is {label, value, index, custom}. Typed custom answers are previewed too (custom: true, value = text). No network access. Returns the chosen label or the custom text.',
      {
        question,
        options: z.array(z.object({
          label: z.string().min(1).max(300),
          value: z.unknown().optional().describe('JSON data passed to the preview, e.g. {"accent":"#e11d48","layout":"grid"}. Defaults to the label.'),
        })).min(2).max(30),
        preview: z.string().min(1).max(100000).describe('HTML with <style> and <script> rendered under the options. Keep it small; it must call basedcode.onPreview.'),
        libraries: librariesField,
      },
      async (_args, progress) => wait(value => z.string().trim().min(1).max(20000).parse(value), progress)),
    definition('query_slider', 'Ask for a number using an in-chat slider and wait for submission.',
      { question, min: z.number().finite(), max: z.number().finite(), step: z.number().positive().finite().optional(), value: z.number().finite().optional() },
      async ({ min, max, step = 1, value }, progress) => {
        if (max <= min || (value !== undefined && (value < min || value > max))) throw new Error('Invalid slider range or initial value.');
        return wait(input => {
          const answer = z.number().finite().min(min).max(max).parse(input);
          const units = (answer - min) / step;
          if (Math.abs(units - Math.round(units)) > 1e-7) throw new Error('Answer does not match the slider step.');
          return answer;
        }, progress);
      }),
    definition('query_color', 'Ask the user to pick a color with an in-chat color picker (color wheel, hex input, your suggested swatches and a contrast preview). Returns a lowercase hex color like "#6366f1".',
      {
        question,
        suggestions: z.array(z.string().regex(hexColorPattern)).max(16).optional().describe('Hex colors to offer as swatches, e.g. a few palette options.'),
        value: z.string().regex(hexColorPattern).optional().describe('Initially selected hex color.'),
      },
      async (_args, progress) => wait(value => z.string().regex(hexColorPattern).parse(value).toLowerCase(), progress)),
    definition('query_font', 'Ask the user to pick a Google Font with an in-chat font picker that previews each font live. It lists popular Google Fonts by category and lets the user type any other Google Font name. Returns the font family name, e.g. "Inter".',
      {
        question,
        fonts: z.array(z.string().regex(fontNamePattern)).max(30).optional().describe('Google Font family names to list first as suggestions.'),
        sampleText: z.string().max(120).optional().describe('Preview text, e.g. the site name or a sample heading.'),
      },
      async (_args, progress) => wait(value => z.string().regex(fontNamePattern).parse(value), progress)),
    definition('query_radius', 'Ask the user how rounded corners should be, with an in-chat slider, presets and a live preview on a card, button and input. Returns a number of pixels (0-48) or "pill".',
      { question, value: z.number().int().min(0).max(48).optional().describe('Initial radius in pixels.') },
      async (_args, progress) => wait(value => z.union([z.literal('pill'), z.number().int().min(0).max(48)]).parse(value), progress)),
    definition('query_ui', 'Show a custom sandboxed HTML/CSS/JS query and wait for a JSON result. Call basedcode.submit(value) from your JavaScript function after user interaction. No network access. The view becomes inactive after submission.',
      { title: z.string().min(1).max(120), html: z.string().min(1).max(200000), libraries: librariesField, files: filesField },
      async (_args, progress) => wait(value => {
        const encoded = JSON.stringify(value);
        if (encoded === undefined || encoded.length > 20000) throw new Error('Submit a JSON result of at most 20000 characters.');
        return JSON.parse(encoded) as unknown;
      }, progress)),
  ];
}
