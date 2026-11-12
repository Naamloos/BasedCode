import { z } from 'zod';
import { cleanOutput, parseProblems } from '../runtime/output.js';
import {
  forModel,
  type DefineTool,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
} from './definitions.js';
import { createPublicFetch } from './publicFetch.js';
import { headTail, htmlToText, squeezeLines } from './textResults.js';

/** Characters of command output the model gets: the start (first errors) and the end (summary, failures). */
const commandOutputLimit = 12_000;

const stoppedByUserNote =
  'The user stopped this terminal. Do not rerun the command; ask the user how to proceed.';

export function createTerminalTools(
  context: ToolContext,
  services: ToolServices,
  definition: DefineTool,
): ToolDefinition[] {
  const { workspace, run, signal } = context;
  const { store, events, permissions, processes } = services;
  const fetchPublic = createPublicFetch(permissions, store, context);

  return [
    definition(
      'run_command',
      'Run a terminal command after user approval. Long output is returned as its start and end, so filter noisy commands (quiet flags, a pipe to a filter) rather than reading everything. background is for dev servers and watchers. Effects may not be undone by prompt revert.',
      {
        command: z.string().min(1).max(20_000),
        background: z.boolean().default(false),
        network: z.boolean().default(false),
        timeoutSeconds: z
          .number()
          .int()
          .min(5)
          .max(900)
          .default(120)
          .describe('Foreground commands are stopped after this long.'),
      },
      async ({ command, background, network, timeoutSeconds }) => {
        await permissions.ask(
          workspace.id,
          'Run terminal command',
          `${command}\n\nFolder: ${workspace.path}\nNetwork requested: ${network}\n${processes.sandbox.detail}\nRevert excludes Git metadata, dependency/generated directories, and external effects.`,
          signal,
          run,
          command,
        );
        const action = store.action(
          workspace.id,
          `Command: ${command.slice(0, 100)}`,
          'May affect uncaptured files or external systems; prompt revert cannot guarantee reversal.',
          run,
        );
        events.publish('state');
        try {
          const result = (await processes.command(
            workspace,
            command,
            run,
            signal,
            background,
            network,
            timeoutSeconds * 1000,
          )) as {
            terminalId: string;
            exitCode?: number;
            output?: string;
            timedOut?: boolean;
            stoppedByUser?: boolean;
            message?: string;
          };
          store.put('action', { ...action, status: 'completed' });
          // The chat keeps the full record for its terminal card; the model gets the condensed text.
          if (background)
            return forModel(
              result,
              `Running in the background as terminal ${result.terminalId}. Use terminal_output or stop_terminal.`,
            );
          const output = headTail(squeezeLines(result.output ?? '').trim(), commandOutputLimit);
          return forModel(
            result,
            `exit ${result.exitCode}${result.timedOut ? ` (stopped after the ${timeoutSeconds}s timeout)` : ''}${result.stoppedByUser ? `\n${stoppedByUserNote}` : ''}\n${output || '(no output)'}`,
          );
        } catch (error) {
          store.put('action', { ...action, status: 'unknown' });
          throw error;
        }
      },
    ),
    definition(
      'terminal_output',
      'Read the latest output and status of a terminal. Returns the tail; pass filter to keep only matching lines (e.g. "error|warn").',
      {
        id: z.string(),
        maxChars: z.number().int().min(200).max(20_000).default(4_000),
        filter: z
          .string()
          .max(300)
          .optional()
          .describe('Case-insensitive regular expression; only matching lines are returned.'),
      },
      async ({ id, maxChars, filter }) => {
        const info = processes.info(id);
        if (info.workspaceId !== workspace.id)
          throw new Error('Terminal belongs to another workspace.');
        let output = squeezeLines(cleanOutput(info.output.slice(-120_000))).trim();
        if (filter) {
          const pattern = new RegExp(filter, 'i');
          output = output
            .split('\n')
            .filter((line) => pattern.test(line))
            .join('\n');
        }
        const status =
          info.status === 'exited'
            ? `exited (${info.exitCode ?? 'unknown'})${info.stoppedByUser ? `\n${stoppedByUserNote}` : ''}`
            : info.status;
        const cut = output.length > maxChars;
        return `${info.title} · ${status}${cut ? ` · last ${maxChars} of ${output.length} characters` : ''}\n${output.slice(-maxChars) || '(no output)'}`;
      },
    ),
    definition(
      'run_checks',
      "Run the workspace's configured checks (lint, type-check, tests) after one approval. Returns pass/fail per check, with file:line problems and the output tail for failures. names runs a subset.",
      {
        names: z.array(z.string()).max(30).optional(),
      },
      async ({ names }, progress) => {
        const checks = workspace.settings.checks.filter(
          (check) => check.command.trim() && (!names?.length || names.includes(check.name)),
        );
        if (!checks.length)
          return workspace.settings.checks.length
            ? `No configured check matches those names. Configured: ${workspace.settings.checks.map((check) => check.name).join(', ')}.`
            : 'No verification checks are configured for this workspace. Ask the user to add them in workspace settings, or use run_command.';
        await permissions.ask(
          workspace.id,
          'Run verification checks',
          `${checks.map((check) => `${check.name}: ${check.command}`).join('\n')}\n\nFolder: ${workspace.path}\n${processes.sandbox.detail}`,
          signal,
          run,
        );
        const results = [];
        for (const check of checks) {
          const action = store.action(
            workspace.id,
            `Check: ${check.name}`,
            `${check.command}\nMay affect uncaptured files or external systems.`,
            run,
          );
          events.publish('state');
          try {
            const result = (await processes.command(
              workspace,
              check.command,
              run,
              signal,
              false,
              false,
            )) as { terminalId: string; exitCode: number; output: string };
            store.put('action', { ...action, status: 'completed' });
            const problems = parseProblems(result.output);
            results.push({
              name: check.name,
              status: result.exitCode === 0 ? 'passed' : 'failed',
              exitCode: result.exitCode,
              terminalId: result.terminalId,
              problems,
              outputTail: cleanOutput(result.output).slice(-4_000),
            });
            progress({ checks: [...results] });
          } catch (error) {
            store.put('action', { ...action, status: 'unknown' });
            throw error;
          }
        }
        const report = results.map((check) => {
          if (check.status === 'passed') return `✓ ${check.name}: passed`;
          const problems = check.problems.map(
            (problem) =>
              `${problem.file}:${problem.line}${problem.column ? `:${problem.column}` : ''} ${problem.severity} ${problem.message}`,
          );
          // Parsed problems already carry the failure; without them the raw tail is the only evidence.
          const tail = squeezeLines(check.outputTail).trim().slice(problems.length ? -1_200 : -3_000);
          return [
            `✗ ${check.name}: failed (exit ${check.exitCode})`,
            ...problems,
            ...(tail ? [`output tail:\n${tail}`] : []),
          ].join('\n');
        });
        return forModel(
          { passed: results.every((item) => item.status === 'passed'), checks: results },
          report.join('\n\n'),
        );
      },
    ),
    definition(
      'terminal_input',
      'Send input to a terminal this prompt started. Requires approval: input can run further commands.',
      { id: z.string(), input: z.string().max(20_000) },
      async ({ id, input }) => {
        const terminal = processes.info(id);
        if (terminal.runId !== run.id || terminal.owner !== 'agent')
          throw new Error('This prompt does not control that terminal.');
        await permissions.ask(
          workspace.id,
          'Send terminal input',
          `${terminal.title}\nInput: ${JSON.stringify(input)}\nInput may execute additional commands with the terminal's existing permissions.`,
          signal,
          run,
        );
        const action = store.action(
          workspace.id,
          `Terminal input: ${terminal.title}`,
          'Input may have effects outside prompt rollback.',
          run,
        );
        try {
          processes.write(id, input, 'agent');
          store.put('action', { ...action, status: 'completed' });
        } catch (error) {
          store.put('action', { ...action, status: 'unknown' });
          throw error;
        }
        return { sent: true };
      },
    ),
    definition(
      'stop_terminal',
      'Stop a command/service started by this prompt.',
      { id: z.string() },
      async ({ id }) => {
        if (processes.info(id).runId !== run.id)
          throw new Error('This prompt does not own that process.');
        processes.stop(id);
        return { stopped: id };
      },
    ),
    definition(
      'web_fetch',
      'GET a public HTTP(S) page after approval. HTML is returned as readable text (markup, scripts and navigation removed), paged by characters: follow the offset it reports. raw returns the source instead.',
      {
        url: z.url(),
        offset: z.number().int().min(0).default(0),
        maxChars: z.number().int().min(500).max(20_000).default(10_000),
        raw: z.boolean().default(false),
      },
      async ({ url, offset, maxChars, raw }) => {
        const fetched = await fetchPublic(
          url,
          'Fetch web page',
          'text/html, text/plain, application/json, text/markdown;q=0.9, */*;q=0.1',
          1_000_000,
          (type) => /^(text\/|application\/(json|xml|javascript|xhtml\+xml))/.test(type),
        );
        const source = fetched.bytes.toString('utf8');
        const body = !raw && /html/i.test(fetched.contentType) ? htmlToText(source) : source;
        const end = Math.min(body.length, offset + maxChars);
        return [
          `${fetched.url} · ${fetched.status} · ${fetched.contentType} · characters ${offset}-${end} of ${body.length}${end < body.length ? ` · more: offset ${end}` : ''}`,
          body.slice(offset, end) || '(no text)',
        ].join('\n');
      },
    ),
  ];
}
