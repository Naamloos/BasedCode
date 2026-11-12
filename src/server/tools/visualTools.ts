import { randomUUID } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { previewMediaType } from '../../shared/preview.js';
import { safePath } from '../workspace/workspace.js';
import {
  type DefineTool,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
} from './definitions.js';
import { createPublicFetch } from './publicFetch.js';
import { filesField, librariesField } from './queryTools.js';

export function createVisualTools(
  context: ToolContext,
  services: ToolServices,
  definition: DefineTool,
): ToolDefinition[] {
  const { workspace } = context;
  const { store, attachmentDirectory, permissions } = services;
  const fetchPublic = createPublicFetch(permissions, store, context);

  return [
    definition(
      'update_plan',
      'Record the task plan as a checklist the user can see. Send the full list each time; mark one step in_progress while working on it and completed when done. Use for multi-step work, not trivial tasks.',
      {
        steps: z
          .array(
            z.object({
              step: z.string().min(1).max(300),
              status: z.enum(['pending', 'in_progress', 'completed']),
            }),
          )
          .min(1)
          .max(30),
        note: z
          .string()
          .max(1000)
          .optional()
          .describe('Optional short update on what changed in the plan.'),
      },
      async ({ steps }) => {
        if (steps.filter((item) => item.status === 'in_progress').length > 1)
          throw new Error('Only one step can be in_progress at a time.');
        const done = steps.filter((item) => item.status === 'completed').length;
        return { recorded: true, progress: `${done}/${steps.length} completed` };
      },
    ),
    definition(
      'render_ui',
      'Show a rich interactive component inline in the chat, built from HTML/CSS/JS. It renders in a sandboxed iframe with no network access (inline scripts, styles and data: images only). Buttons can queue a follow-up prompt for the user: add data-prompt="text" to any element, or call basedcode.prompt("text") from a click handler. Prompts are only sent after the user interacts with the component. Use for choices, previews, small dashboards or visual explanations, not for plain text answers.',
      {
        title: z.string().min(1).max(120).describe('Short label shown above the component.'),
        html: z
          .string()
          .min(1)
          .max(200_000)
          .describe(
            'An HTML fragment or full document. Use CSS variables --fg, --bg, --surface, --muted, --accent and --border to match the app theme.',
          ),
        libraries: librariesField,
        files: filesField,
      },
      async ({ title }) => ({ rendered: true, title }),
    ),
    definition(
      'show_image',
      'Show an image inline in the chat: a workspace file (png, jpg, gif, webp, svg) or a public HTTP(S) URL. URLs need approval, are downloaded once (max 10 MiB) and kept with the chat. Give exactly one of path or url.',
      {
        path: z.string().optional().describe('Workspace-relative image file.'),
        url: z.url().optional().describe('Public image URL.'),
        caption: z.string().max(300).optional(),
      },
      async ({ path, url, caption }) => {
        if (!path === !url) throw new Error('Give exactly one of path or url.');
        if (path) {
          if (!previewMediaType(path)?.startsWith('image/'))
            throw new Error('That file is not a supported image type.');
          if (!(await stat(await safePath(workspace, path))).isFile())
            throw new Error('Select a regular file.');
          return { shown: true, path, caption };
        }
        const fetched = await fetchPublic(
          url!,
          'Fetch image',
          'image/png, image/jpeg, image/gif, image/webp',
          10 * 1_048_576,
          (type) => /^image\/(png|jpeg|gif|webp)$/.test(type.split(';')[0].trim()),
        );
        const mediaType = fetched.contentType.split(';')[0].trim();
        const attachment = store.put('attachment', {
          id: randomUUID(),
          name: new URL(fetched.url).pathname.split('/').at(-1) || 'image',
          mediaType,
          size: fetched.bytes.length,
          createdAt: new Date().toISOString(),
        });
        await writeFile(join(attachmentDirectory, attachment.id), fetched.bytes, { mode: 0o600 });
        return { shown: true, url: fetched.url, attachmentId: attachment.id, caption };
      },
    ),
    definition(
      'render_chart',
      'Draw a chart inline in the chat. Types: line, area, bar, stacked_bar, horizontal_bar, scatter, pie, donut. For category charts give labels plus series values aligned with them; for scatter give each series [x, y] points; pie and donut use the first series against labels.',
      {
        type: z.enum([
          'line',
          'area',
          'bar',
          'stacked_bar',
          'horizontal_bar',
          'scatter',
          'pie',
          'donut',
        ]),
        title: z.string().max(120).optional(),
        labels: z
          .array(z.string().max(60))
          .max(200)
          .optional()
          .describe('Category labels (x axis, or slices for pie/donut).'),
        series: z
          .array(
            z.object({
              name: z.string().max(60),
              values: z
                .array(z.union([z.number(), z.tuple([z.number(), z.number()])]))
                .min(1)
                .max(2000),
            }),
          )
          .min(1)
          .max(12),
        xLabel: z.string().max(60).optional(),
        yLabel: z.string().max(60).optional(),
      },
      async ({ type, labels, series }) => {
        const points = series.every((item) => item.values.every((value) => Array.isArray(value)));
        if (type === 'scatter' && !points) throw new Error('Scatter series need [x, y] points.');
        if (
          type !== 'scatter' &&
          (points ||
            !series.every((item) => item.values.every((value) => typeof value === 'number')))
        )
          throw new Error(`${type} series need plain numbers.`);
        if (
          type !== 'scatter' &&
          labels &&
          series.some((item) => item.values.length !== labels.length)
        )
          throw new Error('Every series needs one value per label.');
        if (
          (type === 'pie' || type === 'donut') &&
          (series[0].values as number[]).some((value) => value < 0)
        )
          throw new Error('Pie and donut values cannot be negative.');
        return { rendered: true, type, series: series.length };
      },
    ),
    definition(
      'render_diagram',
      'Draw a diagram inline in the chat from Mermaid source: flowchart (infrastructure, architecture, data flow), erDiagram (database schemas), sequenceDiagram, classDiagram, stateDiagram-v2, architecture-beta, gantt, mindmap, timeline, gitGraph and more. Prefer short node labels; quote labels containing punctuation. Clicks and links are disabled.',
      {
        title: z.string().max(120).optional(),
        code: z
          .string()
          .min(1)
          .max(50_000)
          .describe(
            'Mermaid source, starting with the diagram type (for example "flowchart LR" or "erDiagram").',
          ),
      },
      async ({ code }) => {
        if (/%%\{\s*init/i.test(code))
          throw new Error('Init directives are not allowed; the app sets the diagram theme.');
        return { rendered: true, type: code.trim().split(/\s/)[0] };
      },
    ),
  ];
}
