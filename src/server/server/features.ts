import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  providerName,
  type Change,
  type Chat,
  type Comparison,
  type Message,
  type ProviderConfig,
  type Run,
  type RunStats,
  type Workspace,
} from '../../shared/types.js';
import type { Agent } from '../agent/agent.js';
import { sendNotice, type Notice } from '../integrations/notify.js';
import type { Events } from '../storage/events.js';
import type { Store } from '../storage/store.js';
import { secondOpinions } from '../tools/chatTools.js';
import type { Checkpoints } from '../workspace/checkpoints.js';
import type { Permissions } from '../workspace/permissions.js';
import { gitCommit, gitPush, gitRead, gitStage, gitStatusEntries } from '../workspace/workspace.js';
import { mkdir } from 'node:fs/promises';
import { id } from './schemas.js';

type StoredRun = Run & { reverted?: boolean };

const activeStatuses = ['queued', 'running', 'paused', 'awaiting_approval'];

/** A model choice from the picker: a connection, optionally with its own model and effort. */
const choice = {
  providerId: id,
  model: z.string().trim().max(200).optional(),
  effort: z.string().trim().max(40).optional(),
};
type Choice = { providerId: string; model?: string; effort?: string };
const label = (provider: ProviderConfig, pick: Choice) =>
  `${providerName(provider)} / ${pick.model || provider.model || 'default'}`;

export interface FeatureDeps {
  store: Store;
  events: Events;
  agent: Agent;
  checkpoints: Checkpoints;
  permissions: Permissions;
  /** Throws unless the workspace has no running agent and no restore in progress. */
  assertIdle: (workspaceId: string) => void;
  /** Throws for forked copies and turns from before a chat moved workspace. */
  assertRevertible: (run: Run) => void;
  /** Runs workspace-changing work with scheduling paused, one restore at a time. */
  maintenance: <T>(work: () => Promise<T>) => Promise<T>;
  /** Empty folder used as core.hooksPath for commits made from BasedCode. */
  hooksDirectory: string;
}

const commitPrompt = `You write git commit messages. Reply with only the message, no code fences or commentary:
line 1: a subject of at most 72 characters, imperative mood ("Add", "Fix"), no trailing period;
line 2: empty;
then a body of short paragraphs or "- " bullets explaining what changed and why, wrapped at about 72 characters.
Describe only what the diff shows. Use the session notes for intent, not as a list of changes.`;

/** Added and removed line counts of a unified diff. */
function lineCounts(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}\n… (${text.length - length} more characters cut)` : text;

/**
 * The newer features that sit on top of the agent and checkpoints: second-opinion reviews, re-run comparisons,
 * provider handoff, the context inspector, rewinding to a tool call, PR descriptions and push notifications.
 */
export class Features {
  constructor(private readonly deps: FeatureDeps) {}

  private get store() {
    return this.deps.store;
  }

  private provider(providerId: string): ProviderConfig {
    const provider = this.store.global().providers.find((item) => item.id === providerId);
    if (!provider) throw new Error('That model connection no longer exists.');
    return provider;
  }

  private turns(chatId: string): StoredRun[] {
    return this.store.all('run').filter((run) => run.chatId === chatId && !run.reverted);
  }

  /** The last turn of its chat that has finished, or an error saying why the run does not qualify. */
  private lastFinished(run: Run, what: string): void {
    const turns = this.turns(run.chatId);
    if (turns.at(-1)?.id !== run.id)
      throw new Error(`Only the latest prompt of a chat can be ${what}. Fork the chat at this prompt first.`);
    if (activeStatuses.includes(run.status)) throw new Error('Wait for this prompt to finish first.');
  }

  /** Copies a chat's turns into a new chat, like a fork. */
  private copyTurns(source: Chat, runs: Run[], overrides: Partial<Chat>): Chat {
    return this.store.transaction(() => {
      const created = this.store.put('chat', {
        id: randomUUID(),
        workspaceId: source.workspaceId,
        title: source.title,
        createdAt: new Date().toISOString(),
        stale: false,
        mode: source.mode,
        ...(source.titleSource ? { titleSource: source.titleSource } : {}),
        ...overrides,
      });
      const runIds = new Map<string, string>();
      for (const run of runs) {
        const copy = this.store.put('run', {
          ...run,
          id: randomUUID(),
          chatId: created.id,
          forkedFrom: run.forkedFrom ?? run.id,
        });
        runIds.set(run.id, copy.id);
      }
      for (const message of this.store.all('message')) {
        const newRun = runIds.get(message.runId);
        if (message.chatId !== source.id || !newRun || message.metadata.reverted) continue;
        this.store.put('message', { ...message, id: randomUUID(), chatId: created.id, runId: newRun });
      }
      return created;
    });
  }

  // ---- 1. Second opinion -------------------------------------------------------------------------------

  /**
   * Starts a read-only review of a prompt's result by any registered model, in a sub-chat of the reviewed chat. The
   * main chat's model can read it with the second_opinions tool.
   */
  async startReview(params: unknown): Promise<Chat> {
    const { runId, focus, ...pick } = z
      .object({ runId: id, ...choice, focus: z.string().trim().max(4000).optional() })
      .parse(params);
    const providerId = pick.providerId;
    const run = this.store.get('run', runId);
    if (activeStatuses.includes(run.status)) throw new Error('Wait for this prompt to finish before reviewing it.');
    const source = this.store.get('chat', run.chatId);
    if (source.mode === 'review') throw new Error('Reviews cannot be reviewed again.');
    const provider = this.provider(providerId);
    const workspace = this.store.get('workspace', run.workspaceId);
    let changes: Change[] = [];
    try {
      changes = await this.deps.checkpoints.changes(workspace, run.id);
    } catch {
      /* No checkpoint: the reviewer reads the files instead. */
    }
    const messages = this.store.all('message').filter((message) => message.runId === run.id && !message.metadata.reverted);
    const completion = messages.findLast((message) => message.metadata.completion);
    const checks = completion?.metadata.checks as
      | { name: string; status: string; command?: string; exitCode?: number }[]
      | undefined;
    // Earlier prompts in the chat give the reviewer the intent behind this one.
    const earlier = this.turns(source.id)
      .filter((item) => item.id !== run.id && item.createdAt < run.createdAt)
      .map((item) => `- ${clip(item.prompt.replace(/\s+/g, ' '), 400)}`);
    // The agent's own narration and every tool step, in order, so the reviewer sees how it got there.
    const steps = messages
      .filter((message) => message.role === 'assistant' || message.role === 'tool' || (message.role === 'user' && message.metadata.steer))
      .map((message) => {
        if (message.role === 'user') return `USER (steering): ${clip(message.content, 1500)}`;
        if (message.role === 'assistant') return message.content.trim() ? `AGENT: ${clip(message.content.trim(), 3000)}` : '';
        const call = message.metadata.tool as
          | { name: string; args: Record<string, unknown>; status: string; error?: string; result?: Record<string, unknown> }
          | undefined;
        if (!call) return '';
        const subject = String(call.args.command ?? call.args.path ?? call.args.query ?? call.args.url ?? call.args.message ?? '').slice(0, 300);
        const exit = typeof call.result?.exitCode === 'number' ? ` → exit ${call.result.exitCode}` : '';
        const output =
          call.name === 'run_command' && typeof call.result?.output === 'string'
            ? `\n    ${clip(call.result.output.trim(), 1200).replace(/\n/g, '\n    ')}`
            : '';
        return `TOOL ${call.name} ${subject}${exit}${call.status === 'failed' ? ` FAILED: ${clip(call.error ?? '', 400)}` : ''}${output}`;
      })
      .filter(Boolean);
    const diff = clip(
      changes.map((change) => (change.binary ? `${change.kind} ${change.path} (binary)` : change.diff)).join('\n'),
      120_000,
    );
    const prompt = [
      `Review the work another agent (${run.provider ?? 'unknown model'}) did for this task. Its result is in the workspace now; read any file you need for context.`,
      earlier.length ? `## Earlier prompts in this chat (for intent)\n${clip(earlier.join('\n'), 6000)}` : '',
      `## Task it was given\n${clip(run.prompt, 12_000)}`,
      run.status !== 'completed' ? `## Note\nThe run ended as "${run.status}"${run.error ? `: ${clip(run.error, 600)}` : ''}. Judge whether the work is complete.` : '',
      steps.length ? `## What the agent did, step by step\n${clip(steps.join('\n'), 40_000)}` : '',
      checks?.length
        ? `## Verification checks after the run\n${checks.map((check) => `- ${check.name}${check.command ? ` (\`${check.command}\`)` : ''}: ${check.status}${check.exitCode !== undefined ? `, exit ${check.exitCode}` : ''}`).join('\n')}`
        : '## Verification checks\nNone are configured, so nothing was run automatically after the agent finished.',
      changes.length
        ? `## The change (${changes.length} file${changes.length === 1 ? '' : 's'}: ${changes.map((change) => `${change.path} ${change.kind}`).join(', ').slice(0, 2000)})\n\`\`\`diff\n${diff}\n\`\`\``
        : '## The change\nNo captured file changes for this prompt. Read the relevant files to review the result.',
      focus ? `## What the user wants you to focus on\n${focus}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const chat = this.store.put('chat', {
      id: randomUUID(),
      workspaceId: run.workspaceId,
      title: `Second opinion: ${label(provider, pick)}`.slice(0, 150),
      titleSource: 'user',
      createdAt: new Date().toISOString(),
      stale: false,
      mode: 'review',
      providerId: provider.id,
      model: pick.model,
      effort: pick.effort,
      reviewOf: { chatId: source.id, runId: run.id },
    });
    this.deps.agent.submit(chat.id, prompt);
    this.deps.events.publish('state');
    return chat;
  }

  // ---- 3. Re-run and compare -----------------------------------------------------------------------------

  /**
   * Repeats a chat's latest prompt with another model. The workspace goes back to the files from before that prompt
   * (its result stays in its checkpoint), a re-run chat is created with the earlier turns, and the prompt runs there
   * with only the chosen model.
   */
  async rerun(params: unknown): Promise<{ chat: Chat; comparison: Comparison }> {
    const { runId, ...pick } = z.object({ runId: id, ...choice }).parse(params);
    const providerId = pick.providerId;
    const chosen = this.provider(providerId);
    return this.deps.maintenance(async () => {
      const run = this.store.get('run', runId);
      this.deps.assertRevertible(run);
      this.lastFinished(run, 're-run');
      if (this.store.get('chat', run.chatId).mode === 'review') throw new Error('Reviews cannot be re-run.');
      this.deps.assertIdle(run.workspaceId);
      const workspace = this.store.get('workspace', run.workspaceId);
      const before = await this.deps.checkpoints.runManifest(workspace, run.id, 'before');
      const after = await this.deps.checkpoints.runManifest(workspace, run.id, 'after');
      const source = this.store.get('chat', run.chatId);
      const earlier = this.turns(run.chatId).slice(0, -1);
      let chat!: Chat;
      await this.deps.checkpoints.switchState(workspace, after, before, `rerun-${run.id}`, () => {
        chat = this.copyTurns(source, earlier, {
          title: `${source.title} (re-run: ${label(chosen, pick)})`.slice(0, 150),
          providerId,
          model: pick.model,
          effort: pick.effort,
          rerunOf: run.id,
          forkedFrom: source.id,
        });
        // The original chat's files are no longer in the workspace until its result is kept.
        this.store.put('chat', { ...source, stale: true });
      });
      const original = this.store
        .all('message')
        .find((message) => message.runId === run.id && message.role === 'user' && !message.metadata.steer);
      const attachments = (original?.metadata.attachments as { id: string }[] | undefined) ?? [];
      const rerun = this.deps.agent.submit(chat.id, run.prompt, attachments.map((item) => item.id));
      const comparison = this.store.put('comparison', {
        id: randomUUID(),
        workspaceId: workspace.id,
        originalRunId: run.id,
        rerunRunId: rerun.id,
        current: rerun.id,
        createdAt: new Date().toISOString(),
      });
      this.deps.events.publish('state');
      this.deps.events.publish('files-changed', null, workspace.id);
      return { chat, comparison };
    });
  }

  private async side(workspace: Workspace, runId: string) {
    const run = this.store.get('run', runId);
    let changes: Change[] = [];
    let changeError: string | undefined;
    if (!activeStatuses.includes(run.status)) {
      try {
        const before = await this.deps.checkpoints.runManifest(workspace, runId, 'before');
        const after = await this.deps.checkpoints.runManifest(workspace, runId, 'after');
        changes = await this.deps.checkpoints.diffStates(workspace, before, after);
      } catch (error) {
        changeError = error instanceof Error ? error.message : String(error);
      }
    }
    const messages = this.store.all('message').filter((message) => message.runId === runId);
    const checks =
      (messages.findLast((message) => message.metadata.completion)?.metadata.checks as
        | { name: string; status: string }[]
        | undefined) ?? [];
    const lines = changes.reduce(
      (total, change) => {
        const counts = lineCounts(change.diff);
        return { added: total.added + counts.added, removed: total.removed + counts.removed };
      },
      { added: 0, removed: 0 },
    );
    return {
      runId,
      chatId: run.chatId,
      provider: run.provider ?? 'unknown',
      status: run.status,
      error: run.error,
      stats: run.stats as RunStats | undefined,
      toolCalls: messages.filter((message) => message.role === 'tool').length,
      files: changes.map((change) => ({ path: change.path, kind: change.kind, ...lineCounts(change.diff) })),
      changeError,
      ...lines,
      checks,
    };
  }

  /** Both sides of a comparison, and how often each model's result was kept in this workspace's past comparisons. */
  async comparison(params: unknown) {
    const { comparisonId } = z.object({ comparisonId: id }).parse(params);
    const comparison = this.store.get('comparison', comparisonId);
    const workspace = this.store.get('workspace', comparison.workspaceId);
    const sides = [
      await this.side(workspace, comparison.originalRunId),
      await this.side(workspace, comparison.rerunRunId),
    ];
    const tally = new Map<string, { model: string; kept: number; compared: number }>();
    const runs = new Map(this.store.all('run').map((run) => [run.id, run]));
    for (const item of this.store.all('comparison')) {
      if (item.workspaceId !== workspace.id || !item.kept) continue;
      for (const runId of [item.originalRunId, item.rerunRunId]) {
        const model = runs.get(runId)?.provider ?? 'unknown';
        const entry = tally.get(model) ?? { model, kept: 0, compared: 0 };
        entry.compared++;
        if (item.kept === runId) entry.kept++;
        tally.set(model, entry);
      }
    }
    return {
      comparison,
      sides,
      leaderboard: [...tally.values()].sort((a, b) => b.kept / b.compared - a.kept / a.compared),
    };
  }

  /** Puts one side's files in the workspace and records it as the winner. */
  async keep(params: unknown): Promise<Comparison> {
    const { comparisonId, runId } = z.object({ comparisonId: id, runId: id }).parse(params);
    return this.deps.maintenance(async () => {
      const comparison = this.store.get('comparison', comparisonId);
      if (![comparison.originalRunId, comparison.rerunRunId].includes(runId))
        throw new Error('That prompt is not part of this comparison.');
      for (const side of [comparison.originalRunId, comparison.rerunRunId])
        if (activeStatuses.includes(this.store.get('run', side).status))
          throw new Error('Wait for both prompts to finish before keeping one.');
      this.deps.assertIdle(comparison.workspaceId);
      const workspace = this.store.get('workspace', comparison.workspaceId);
      const winner = this.store.get('run', runId);
      const loser = this.store.get('run', runId === comparison.originalRunId ? comparison.rerunRunId : comparison.originalRunId);
      const record = () => {
        this.store.put('chat', { ...this.store.get('chat', winner.chatId), stale: false });
        this.store.put('chat', { ...this.store.get('chat', loser.chatId), stale: true });
        return this.store.put('comparison', { ...comparison, current: runId, kept: runId });
      };
      if (comparison.current === runId) {
        const kept = this.store.transaction(record);
        this.deps.events.publish('state');
        return kept;
      }
      const expected = await this.deps.checkpoints.runManifest(workspace, comparison.current, 'after');
      const target = await this.deps.checkpoints.runManifest(workspace, runId, 'after');
      let kept!: Comparison;
      await this.deps.checkpoints.switchState(workspace, expected, target, `keep-${comparisonId}`, () => {
        kept = record();
      });
      this.deps.events.publish('state');
      this.deps.events.publish('files-changed', null, workspace.id);
      return kept;
    });
  }

  // ---- 4. Continue with another model --------------------------------------------------------------------

  /** Sets which model a chat uses first. `null` returns it to the workspace fallback order. */
  setChatProvider(params: unknown): null {
    const { chatId, providerId, model, effort } = z
      .object({ ...choice, chatId: id, providerId: id.nullable() })
      .parse(params);
    if (providerId) this.provider(providerId);
    const chat = this.store.get('chat', chatId);
    if (chat.mode === 'review' || chat.rerunOf)
      throw new Error('Reviews and re-runs keep the model they were started with.');
    this.store.put('chat', {
      ...chat,
      providerId: providerId ?? undefined,
      model: providerId ? model : undefined,
      effort: providerId ? effort : undefined,
    });
    this.deps.events.publish('state');
    return null;
  }

  /**
   * Hands the chat to another model now: a running prompt is stopped, and the new model is asked to pick up where the
   * last one left off, with the whole conversation and every tool result so far.
   */
  async handoff(params: unknown): Promise<Run> {
    const { chatId, ...pick } = z.object({ chatId: id, ...choice }).parse(params);
    const provider = this.provider(pick.providerId);
    this.setChatProvider({ chatId, ...pick });
    const running = this.turns(chatId).filter((run) => activeStatuses.includes(run.status));
    for (const run of running) await this.deps.agent.stop(run.id);
    const previous = this.turns(chatId).at(-1);
    return this.deps.agent.submit(
      chatId,
      `Continue this task from where the previous model${previous?.provider ? ` (${previous.provider})` : ''} left off. You are ${label(provider, pick)}, taking over this chat. Check the current state of the files before continuing, since the earlier work may be unfinished. If the task is already done, say so and summarize what was done.`,
    );
  }

  // ---- 5. Context inspector ------------------------------------------------------------------------------

  inspect(params: unknown) {
    const { chatId } = z.object({ chatId: id }).parse(params);
    return this.deps.agent.inspectContext(chatId);
  }

  /** Pins a message (kept verbatim through compaction) or excludes it (never sent to the model). */
  flag(params: unknown): null {
    const { messageId, pinned, excluded } = z
      .object({ messageId: id, pinned: z.boolean().optional(), excluded: z.boolean().optional() })
      .parse(params);
    const message = this.store.get('message', messageId);
    if (this.deps.agent.chatBusy(message.chatId))
      throw new Error("Wait for this chat's prompt to finish before changing its context.");
    const metadata = { ...message.metadata };
    if (pinned !== undefined) metadata.pinned = pinned || undefined;
    if (excluded !== undefined) metadata.excluded = excluded || undefined;
    if (metadata.pinned && metadata.excluded) throw new Error('A message cannot be pinned and excluded.');
    this.store.put('message', { ...message, metadata });
    this.deps.events.publish('state');
    return null;
  }

  // ---- 6. Rewind to a tool call --------------------------------------------------------------------------

  private async rewindTarget(messageId: string) {
    const message = this.store.get('message', messageId);
    if (message.role !== 'tool' || !this.deps.checkpoints.hasToolSnapshot(messageId))
      throw new Error('This tool call has no snapshot to rewind to.');
    const run = this.store.get('run', message.runId);
    this.deps.assertRevertible(run);
    this.lastFinished(run, 'rewound');
    const workspace = this.store.get('workspace', run.workspaceId);
    const expected = await this.deps.checkpoints.runManifest(workspace, run.id, 'after');
    const target = await this.deps.checkpoints.toolManifest(workspace, messageId);
    const all = this.store.all('message');
    const from = all.findIndex((item) => item.id === messageId);
    const dropped = all.slice(from).filter((item) => item.runId === run.id && !item.metadata.reverted);
    const startedAt = message.createdAt;
    const actions = this.store
      .all('action')
      .filter((action) => action.runId === run.id && !action.reverted && action.createdAt >= startedAt);
    return { message, run, workspace, expected, target, dropped, actions };
  }

  async rewindPreview(params: unknown) {
    const { messageId } = z.object({ messageId: id }).parse(params);
    const target = await this.rewindTarget(messageId);
    if (this.deps.agent.busy(target.workspace)) throw new Error('Stop the active agent before rewinding.');
    const { paths, conflicts } = await this.deps.checkpoints.previewSwitch(target.workspace, target.expected, target.target);
    return { paths, conflicts, messages: target.dropped.length, actions: target.actions.map((action) => action.title) };
  }

  /**
   * Restores files to just before a tool call and drops that call and everything after it in the run. The
   * conversation then continues from there with the user's next prompt.
   */
  async rewind(params: unknown): Promise<null> {
    const { messageId } = z.object({ messageId: id }).parse(params);
    return this.deps.maintenance(async () => {
      const target = await this.rewindTarget(messageId);
      this.deps.assertIdle(target.workspace.id);
      await this.deps.checkpoints.switchState(target.workspace, target.expected, target.target, `rewind-${messageId}`, () => {
        for (const message of target.dropped)
          this.store.put('message', { ...message, metadata: { ...message.metadata, reverted: true } });
        for (const action of target.actions) this.store.put('action', { ...action, reverted: true });
        this.store.message(
          target.run.chatId,
          target.run.id,
          'system',
          `Rewound to just before ${String((target.message.metadata.tool as { name?: string }).name ?? 'a tool call')}: files restored and ${target.dropped.length} later message(s) dropped. Send a prompt to continue from here.`,
          { rewind: true },
        );
      });
      await this.deps.checkpoints.refreshAfter(target.workspace, target.run.id);
      this.deps.events.publish('state');
      this.deps.events.publish('files-changed', null, target.workspace.id);
      return null;
    });
  }

  // ---- 11. PR description --------------------------------------------------------------------------------

  /**
   * A PR description written from the audit trail, not from the model's memory: the prompts, the files that changed,
   * the commands that ran with their exit codes, check results, irreversible actions and second opinions.
   */
  async prDescription(params: unknown): Promise<{ title: string; body: string }> {
    const { chatId } = z.object({ chatId: id }).parse(params);
    const chat = this.store.get('chat', chatId);
    const workspace = this.store.get('workspace', chat.workspaceId);
    const runs = this.turns(chatId).filter((run) => !run.forkedFrom && !activeStatuses.includes(run.status));
    const runIds = new Set(runs.map((run) => run.id));
    const messages = this.store.all('message').filter((message) => runIds.has(message.runId) && !message.metadata.reverted);
    const files = new Map<string, { kind: Change['kind']; added: number; removed: number }>();
    let uncaptured = 0;
    for (const run of runs) {
      try {
        for (const change of await this.deps.checkpoints.changes(workspace, run.id)) {
          const counts = lineCounts(change.diff);
          const existing = files.get(change.path);
          files.set(change.path, {
            kind: existing?.kind === 'created' && change.kind !== 'deleted' ? 'created' : change.kind,
            added: (existing?.added ?? 0) + counts.added,
            removed: (existing?.removed ?? 0) + counts.removed,
          });
        }
      } catch {
        uncaptured++;
      }
    }
    const tool = (message: Message) =>
      message.metadata.tool as
        | { name: string; args: Record<string, unknown>; status: string; result?: { exitCode?: number } }
        | undefined;
    const commands = messages
      .filter((message) => message.role === 'tool' && tool(message)?.name === 'run_command')
      .map((message) => {
        const call = tool(message)!;
        const exit = call.result?.exitCode;
        return `- \`${String(call.args.command).replace(/`/g, "'").slice(0, 200)}\` ${call.status === 'failed' ? '(failed)' : exit === undefined ? '' : exit === 0 ? '✓' : `(exit ${exit})`}`.trimEnd();
      });
    const checks = runs.flatMap((run) => {
      const completion = messages.findLast((message) => message.runId === run.id && message.metadata.completion);
      return (completion?.metadata.checks as { name: string; status: string; exitCode?: number }[] | undefined) ?? [];
    });
    const latestChecks = new Map(checks.map((check) => [check.name, check]));
    const actions = this.store
      .all('action')
      .filter((action) => action.runId && runIds.has(action.runId) && !action.reverted && !action.title.startsWith('Check:'));
    const reviews = secondOpinions(this.store, chatId).filter((review) => review.review);
    const models = [...new Set(runs.map((run) => run.provider).filter(Boolean))];
    const prompts = runs.filter((run) => !run.prompt.startsWith('Continue this task from where'));
    const sections = [
      `## Summary\n${prompts.map((run) => `- ${run.prompt.split('\n')[0].slice(0, 160)}`).join('\n') || '- (no prompts)'}`,
      `## Changes\n${
        files.size
          ? [...files]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([path, file]) => `- \`${path}\` ${file.kind}${file.added || file.removed ? ` (+${file.added} −${file.removed})` : ''}`)
              .join('\n')
          : '- No captured file changes.'
      }${uncaptured ? `\n\n_${uncaptured} prompt(s) had no checkpoint, so their changes are not listed._` : ''}`,
      latestChecks.size
        ? `## Verification\n${[...latestChecks.values()].map((check) => `- ${check.status === 'passed' ? '✅' : check.status === 'failed' ? '❌' : '⏭️'} ${check.name}: ${check.status}`).join('\n')}`
        : '',
      commands.length ? `## Commands run by the agent\n${commands.slice(0, 40).join('\n')}${commands.length > 40 ? `\n- … and ${commands.length - 40} more` : ''}` : '',
      actions.length
        ? `## Side effects outside the repository\n${actions.map((action) => `- ${action.title} (${action.status})`).join('\n')}`
        : '',
      reviews.length
        ? `## Second opinions\n${reviews.map((review) => `- ${review.reviewer}: ${/Verdict:\s*([^\n]+)/i.exec(review.review)?.[1]?.trim() ?? 'see review'}`).join('\n')}`
        : '',
      `---\n_Written by BasedCode from the session's audit trail. Models: ${models.join(', ') || 'unknown'}._`,
    ];
    return { title: chat.title, body: sections.filter(Boolean).join('\n\n') };
  }

  // ---- Git panel -----------------------------------------------------------------------------------------

  private workspaceOf(params: unknown) {
    const { workspaceId } = z.object({ workspaceId: id }).parse(params);
    return this.store.get('workspace', workspaceId);
  }

  gitStatus(params: unknown) {
    return gitStatusEntries(this.workspaceOf(params));
  }

  async gitStage(params: unknown) {
    const { workspaceId, paths, unstage } = z
      .object({ workspaceId: id, paths: z.array(z.string().min(1).max(1000)).min(1).max(5000), unstage: z.boolean() })
      .parse(params);
    const workspace = this.store.get('workspace', workspaceId);
    if (this.deps.agent.busy(workspace)) throw new Error('Wait for the agent to finish before staging.');
    await gitStage(workspace, paths, unstage);
    this.deps.events.publish('files-changed', null, workspaceId);
    return gitStatusEntries(workspace);
  }

  async gitCommit(params: unknown) {
    const { workspaceId, message, stageAll } = z
      .object({ workspaceId: id, message: z.string().trim().min(1).max(20_000), stageAll: z.boolean() })
      .parse(params);
    const workspace = this.store.get('workspace', workspaceId);
    if (this.deps.agent.busy(workspace)) throw new Error('Wait for the agent to finish before committing.');
    // Nothing staged commits everything, matching what the message was written about.
    if (stageAll) await gitStage(workspace, ['.'], false);
    await mkdir(this.deps.hooksDirectory, { recursive: true });
    const summary = await gitCommit(workspace, message, this.deps.hooksDirectory);
    this.store.put('action', { ...this.store.action(workspaceId, 'Git commit', summary.slice(0, 2000)), status: 'completed' });
    this.deps.events.publish('files-changed', null, workspaceId);
    this.deps.events.publish('state');
    return { summary, status: await gitStatusEntries(workspace) };
  }

  async gitPush(params: unknown) {
    const workspace = this.workspaceOf(params);
    const action = this.store.action(workspace.id, 'Git push', workspace.path);
    try {
      const output = await gitPush(workspace);
      this.store.put('action', { ...action, status: 'completed', detail: output.slice(0, 2000) });
      return { output, status: await gitStatusEntries(workspace) };
    } catch (error) {
      this.store.put('action', { ...action, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      this.deps.events.publish('state');
    }
  }

  /**
   * A commit subject and body written by the chat's model from the diff: the staged changes when some (but not all)
   * are staged, otherwise every change. The chat's audit trail is passed along as notes on intent.
   */
  async gitMessage(params: unknown): Promise<{ title: string; body: string; model: string; scope: 'staged' | 'all' }> {
    const { workspaceId, chatId } = z.object({ workspaceId: id, chatId: id.optional() }).parse(params);
    const workspace = this.store.get('workspace', workspaceId);
    const status = await gitStatusEntries(workspace);
    const staged = status.files.filter((file) => file.index !== ' ' && file.index !== '?');
    const scope = staged.length && staged.length < status.files.length ? 'staged' : 'all';
    const diff = await gitRead(workspace, 'diff', scope === 'staged' ? { staged: true } : {});
    if (!diff.trim()) throw new Error('There are no changes to describe.');
    let notes = '';
    if (chatId) {
      try {
        notes = (await this.prDescription({ chatId })).body;
      } catch {
        /* No usable audit trail: the diff alone will do. */
      }
    }
    const { text, model } = await this.deps.agent.writeText(
      workspace,
      chatId,
      commitPrompt,
      `${notes ? `Session notes from the chat that made these changes:\n${clip(notes, 6000)}\n\n` : ''}Diff (${scope === 'staged' ? 'staged changes only' : 'all changes'}):\n${clip(diff, 80_000)}`,
    );
    const clean = text.replace(/^```\w*\n?|\n?```$/g, '').trim();
    const [title, ...rest] = clean.split('\n');
    return { title: title.trim(), body: rest.join('\n').trim(), model, scope };
  }

  // ---- 10. Push notifications ---------------------------------------------------------------------------

  notify(kind: 'approvals' | 'finished', notice: Notice): void {
    const settings = this.store.global().notifications;
    if (!settings?.enabled || !settings.url || !settings[kind]) return;
    void sendNotice(settings, notice).catch(() => undefined);
  }

  /** Sends a test notification with the saved settings, reporting failures to the caller. */
  async testNotification(): Promise<null> {
    const settings = this.store.global().notifications;
    if (!settings?.url) throw new Error('Save a notification URL first.');
    await sendNotice(settings, {
      title: 'BasedCode test notification',
      body: 'Notifications work. You will get one when a prompt needs your approval or finishes.',
      priority: 'default',
      tags: ['white_check_mark'],
    });
    return null;
  }

  /** Wires approvals and finished prompts to push notifications. */
  attachNotifications(): void {
    const name = (workspaceId: string) => {
      try {
        return this.store.get('workspace', workspaceId).name;
      } catch {
        return 'BasedCode';
      }
    };
    this.deps.permissions.onPending = (approval) =>
      this.notify('approvals', {
        title: `Approval needed: ${approval.title}`,
        body: `${name(approval.workspaceId)}: ${approval.detail.split('\n')[0].slice(0, 200)}`,
        priority: 'high',
        tags: ['warning'],
      });
  }

  runFinished(runId: string): void {
    const run = this.store.get('run', runId);
    if (!['completed', 'failed', 'interrupted'].includes(run.status)) return;
    const chat = this.store.get('chat', run.chatId);
    this.notify('finished', {
      title: `${run.status === 'completed' ? 'Done' : run.status === 'failed' ? 'Failed' : 'Stopped'}: ${chat.title.slice(0, 80)}`,
      body: run.status === 'completed' ? `${run.provider ?? ''} finished the prompt.`.trim() : (run.error ?? '').slice(0, 300),
      priority: 'default',
      tags: [run.status === 'completed' ? 'white_check_mark' : 'x'],
    });
  }
}
