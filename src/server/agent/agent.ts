import { createOpenAI } from '@ai-sdk/openai';
import {
  extractReasoningMiddleware,
  generateText,
  streamText,
  tool,
  wrapLanguageModel,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UserContent,
} from 'ai';
import {
  createClaudeCode,
  createCustomMcpServer,
  type EffortLevel,
  type MessageInjector,
} from 'ai-sdk-provider-claude-code';
import {
  tool as codexTool,
  createCodexAppServer,
  createCodexExec,
  createLocalMcpServer,
  type ReasoningEffort,
} from 'ai-sdk-provider-codex-cli';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  effectiveBudget,
  effectiveFixFailedChecks,
  effectiveProviders,
  providerName,
  reasoningOff,
  steerableKinds,
  type Attachment,
  type Chat,
  type Message,
  type ProviderConfig,
  type ProviderKind,
  type Run,
  type RunStats,
  type Workspace,
} from '../../shared/types.js';
import { antigravityOptions, cliPath } from '../providers/cli.js';
import { AgyError, antigravity } from 'eve-antigravity';
import { CodexHome, codexConfig } from '../providers/codexHome.js';
import { Credentials } from '../providers/credentials.js';
import type { Limits } from '../providers/limits.js';
import { estimateCost } from '../providers/pricing.js';
import { reasoningFetch, withoutReasoning } from '../providers/reasoning.js';
import { cleanOutput } from '../runtime/output.js';
import { Processes } from '../runtime/processes.js';
import { Events } from '../storage/events.js';
import { Store } from '../storage/store.js';
import {
  CodingTools,
  fileChangingTools,
  inputSchema,
  isImageResult,
  resultImages,
  readOnlyTools,
  type ToolDefinition,
} from '../tools/tools.js';
import { Checkpoints } from '../workspace/checkpoints.js';
import { Permissions } from '../workspace/permissions.js';
import { overlap } from '../workspace/workspace.js';
import {
  attachmentTextLimit,
  estimateTokens,
  compactObservation,
  observationPrefix,
  imageCaption,
  imageTypes,
  isTextAttachment,
} from './context.js';
import {
  QuotaError,
  contextOverflowText,
  failureKind,
  maxTransientRetries,
  retryDelayMs,
  usageLimitText,
} from './failures.js';
import { instructionsPrompt, loadInstructions, type InstructionFile } from './instructions.js';
import { localStep } from './localLoop.js';
import { guidedMode } from '../../shared/chatModes.js';
import { compactionPrompt, personalizedSystemPrompt, reviewPrompt, scratchPrompt } from './prompts.js';
import { envSecrets, findSecrets, isOutboundTool } from './secrets.js';
import { secondOpinions } from '../tools/chatTools.js';
import { deferTools, type OfferedTools } from '../tools/deferred.js';
import { codexDisabledFeatures, nativeApproval } from './providerPolicy.js';

// Preserve imports used by integrations while keeping the implementation in focused modules.
export { isTextAttachment } from './context.js';
export { codexDisabledFeatures } from './providerPolicy.js';

interface ActiveRun {
  controller: AbortController;
  workspace: Workspace;
  completion: Promise<void>;
  /** Provider currently working; decides whether a steering message can be delivered. */
  kind?: ProviderKind;
  /** Steering messages waiting for the local loop's next step. */
  inbox: ModelMessage[];
  injector?: MessageInjector;
  /** Set when the watchdog stopped the run because it went silent. */
  stalled?: boolean;
}

/** A tool's input schema as JSON text, for estimating what its definition costs in the prompt. */
function schemaText(definition: ToolDefinition): string {
  try {
    return JSON.stringify(z.toJSONSchema(inputSchema(definition.shape)));
  } catch {
    return JSON.stringify(Object.keys(definition.shape));
  }
}

/** A running prompt with no output and no running tool for this long is stopped, so it can be resumed. */
export const stallTimeoutMs = 10 * 60 * 1000;

export class Agent {
  private readonly active = new Map<string, ActiveRun>();
  private watchdog?: ReturnType<typeof setInterval>;
  private readonly compacting = new Map<string, Workspace>();
  private pumping = false;
  private suspended = false;

  constructor(
    private readonly store: Store,
    private readonly events: Events,
    private readonly permissions: Permissions,
    private readonly checkpoints: Checkpoints,
    private readonly processes: Processes,
    private readonly tools: CodingTools,
    private readonly credentials: Credentials,
    private readonly attachmentDirectory: string,
    private readonly limits: Limits,
    private readonly codexHome?: CodexHome,
  ) {}

  /**
   * Environment for a Codex process: a private CODEX_HOME when auth.json can be copied, so user-level config, AGENTS.md,
   * rules and plugins do not load. Always call finish() afterwards so rotated tokens reach the user's own login.
   */
  private async codexEnvironment(
    env: Record<string, string | undefined>,
  ): Promise<{ env: Record<string, string>; isolated: boolean; finish: () => Promise<void> }> {
    const prepared = await this.codexHome?.prepare(codexConfig(codexDisabledFeatures));
    const merged = { ...env, ...(prepared ? { CODEX_HOME: prepared.home } : {}) };
    return {
      env: Object.fromEntries(
        Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      isolated: Boolean(prepared),
      finish: prepared?.finish ?? (async () => undefined),
    };
  }

  private attachments(ids: string[]): Attachment[] {
    return ids.map((id) => this.store.get('attachment', id));
  }

  submit(chatId: string, prompt: string, attachmentIds: string[] = [], metadata: Record<string, unknown> = {}): Run {
    if (this.checkpoints.hasRecovery)
      throw new Error('Recover the interrupted restore before starting work.');
    const chat = this.store.get('chat', chatId);
    if (chat.deletedAt) throw new Error('This chat has been deleted.');
    const attachments = this.attachments(attachmentIds);
    const run = this.store.put('run', {
      id: randomUUID(),
      chatId,
      workspaceId: chat.workspaceId,
      prompt,
      status: 'queued',
      createdAt: new Date().toISOString(),
    });
    if (chat.title === 'New chat') this.store.put('chat', { ...chat, title: prompt.slice(0, 70) });
    this.store.message(chatId, run.id, 'user', prompt, { ...metadata, ...(attachments.length ? { attachments } : {}) });
    this.events.publish('state');
    void this.pump();
    return run;
  }

  /**
   * Delivers a message to a run that is already working. Local models read it before their next step; Claude Code gets it
   * injected into its live session. Codex exec takes no input mid-turn, so the caller should queue instead.
   */
  steer(runId: string, prompt: string, attachmentIds: string[] = []): void {
    const entry = this.active.get(runId);
    const run = this.store.get('run', runId);
    if (this.compacting.has(run.chatId)) {
      this.submit(run.chatId, prompt, attachmentIds);
      return;
    }
    if (!entry || !['running', 'paused'].includes(run.status))
      throw new Error('This prompt is not running. Send it as a new prompt instead.');
    if (!entry.kind || !steerableKinds.includes(entry.kind))
      throw new Error(
        `${entry.kind ?? 'This provider'} cannot take messages mid-run. Queue it instead.`,
      );
    const attachments = this.attachments(attachmentIds);
    if (entry.kind === 'claude' && attachments.length)
      throw new Error(
        'Claude Code steering accepts text only. Queue a prompt to send attachments.',
      );
    const message = this.store.message(run.chatId, run.id, 'user', prompt, {
      steer: true,
      ...(attachments.length ? { attachments } : {}),
    });
    if (entry.kind === 'claude') {
      if (!entry.injector)
        throw new Error('Claude Code is still starting. Try again in a moment, or queue it.');
      entry.injector.inject(
        `Steering message from the user (sent while you were working):\n${prompt}`,
        (delivered) => {
          if (!delivered)
            this.store.message(
              run.chatId,
              run.id,
              'system',
              'Claude Code finished before the steering message arrived. Send it again as a new prompt.',
              { error: true },
            );
          this.events.publish('state');
        },
      );
    } else
      entry.inbox.push({
        role: 'user',
        content: this.userContent(
          message,
          'Steering message from the user (sent while you were working):\n',
        ),
      });
    this.events.publish('state');
  }

  busy(workspace: Workspace): boolean {
    return (
      [...this.active.values()].some((item) => overlap(item.workspace.path, workspace.path)) ||
      [...this.compacting.values()].some((item) => overlap(item.path, workspace.path))
    );
  }

  chatBusy(chatId: string): boolean {
    return (
      this.compacting.has(chatId) ||
      [...this.active.keys()].some((id) => this.store.get('run', id).chatId === chatId)
    );
  }

  /** Called after each prompt finishes, whatever its outcome. */
  onRunFinished?: (workspace: Workspace, runId: string) => void;

  private async pump(): Promise<void> {
    if (this.pumping || this.suspended) return;
    this.pumping = true;
    try {
      for (const run of this.store
        .all('run')
        .filter((item) => item.status === 'queued' && !item.reverted)) {
        const workspace = this.store.get('workspace', run.workspaceId);
        if (this.busy(workspace)) continue;
        const controller = new AbortController();
        const entry: ActiveRun = {
          controller,
          workspace,
          completion: Promise.resolve(),
          inbox: [],
        };
        this.active.set(run.id, entry);
        this.store.runActivity.set(run.id, Date.now());
        this.watchdog ??= setInterval(() => this.checkStalled(), 30_000);
        this.watchdog.unref?.();
        entry.completion = Promise.resolve().then(() => this.execute(workspace, run, controller));
        void entry.completion.finally(() => {
          this.active.delete(run.id);
          this.onRunFinished?.(workspace, run.id);
          this.events.publish('state');
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  private update(run: Run, patch: Partial<Run>): void {
    Object.assign(run, patch);
    this.store.put('run', run);
    this.events.publish('state');
  }

  /** A user message as model content: its text plus attachments (images as images, text files inline, others described). */
  private userContent(message: Message, prefix = ''): UserContent {
    const attachments = (message.metadata.attachments as Attachment[] | undefined) ?? [];
    if (!attachments.length) return prefix + message.content;
    const parts: Exclude<UserContent, string> = [{ type: 'text', text: prefix + message.content }];
    for (const attachment of attachments) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(this.attachmentDirectory, attachment.id));
      } catch {
        parts.push({
          type: 'text',
          text: `[Attachment "${attachment.name}" is no longer available.]`,
        });
        continue;
      }
      if (imageTypes.has(attachment.mediaType))
        parts.push({ type: 'file', data: bytes, mediaType: attachment.mediaType });
      else if (isTextAttachment(attachment) && !bytes.subarray(0, 8000).includes(0)) {
        const text = bytes.toString('utf8');
        const cut = text.length > attachmentTextLimit;
        parts.push({
          type: 'text',
          text: `Attached file "${attachment.name}" (attachment id ${attachment.id})${cut ? ` (first ${attachmentTextLimit} characters of ${text.length})` : ''}:\n\`\`\`\n${cut ? text.slice(0, attachmentTextLimit) : text}\n\`\`\``,
        });
      } else
        parts.push({
          type: 'text',
          text: `[Attached file "${attachment.name}" (${attachment.mediaType}, ${attachment.size} bytes, attachment id ${attachment.id}) is not inlined. For PDF/Office/ODF/EPUB/RTF documents call extract_document with this attachmentId. Widgets can load it through the files argument of render_ui/query_ui.]`,
        });
    }
    return parts;
  }

  /** Messages of a chat up to and including a run, in order, without reverted turns. */
  private history(chatId: string, runId?: string): Message[] {
    const turns = this.store.all('run').filter((run) => run.chatId === chatId && !run.reverted);
    const until = runId ? turns.findIndex((run) => run.id === runId) + 1 : turns.length;
    const permitted = new Set(turns.slice(0, until).map((run) => run.id));
    return this.store
      .all('message')
      .filter(
        (message) =>
          message.chatId === chatId &&
          permitted.has(message.runId) &&
          !message.metadata.reverted &&
          (message.content || message.metadata.compaction),
      );
  }

  /** The model-facing conversation. After a compaction, older messages are replaced by its summary. */
  private transcript(chatId: string, runId: string): ModelMessage[] {
    const history = this.history(chatId, runId);
    const compaction = history.findLast((message) => message.metadata.compaction);
    const summary = compaction?.metadata.compaction as
      { summary: string; through: string } | undefined;
    const start = summary ? history.findIndex((message) => message.id === summary.through) + 1 : 0;
    // Pinned messages the summary replaced still go to the model verbatim, right after the summary.
    const pinned = history
      .slice(0, start)
      .filter((message) => message.metadata.pinned && !message.metadata.excluded);
    const messages: ModelMessage[] = summary
      ? [
          {
            role: 'user',
            content: `Summary of the earlier conversation (compacted by BasedCode; details may be lost):\n${summary.summary}`,
          },
        ]
      : [];
    // Keep the active task verbatim even after compacting earlier steps of the same run.
    const prompt = history
      .slice(0, start)
      .find((message) => message.runId === runId && message.role === 'user');
    if (prompt) messages.push({ role: 'user', content: this.userContent(prompt) });
    for (const message of [...pinned.filter((item) => item !== prompt), ...history.slice(start)]) {
      if (message.metadata.compaction) continue;
      // Dropped by the user in the context inspector: kept in the chat, never sent.
      if (message.metadata.excluded) continue;
      // Completion banners are UI-only; feeding them back as assistant turns makes the model echo them.
      if (message.role === 'system' && message.metadata.completion) continue;
      // Failed-check reports are the next instruction to the model, not something it said.
      if (message.role === 'system' && message.metadata.fixup) {
        messages.push({
          role: 'user',
          content: `${message.content}\n\nFix the cause of these failures, then finish. Do not weaken or skip the checks.`,
        });
        continue;
      }
      if (message.metadata.browserScreenshot) {
        messages.push({ role: 'user', content: this.userContent(message) });
        continue;
      }
      if (message.role === 'user')
        messages.push({
          role: 'user',
          content: this.userContent(
            message,
            message.metadata.steer
              ? 'Steering message from the user (sent while you were working):\n'
              : '',
          ),
        });
      else if (message.role === 'tool')
        messages.push({
          role: 'assistant',
          content: `${observationPrefix}${compactObservation(
            message.metadata.tool,
            message.runId === runId,
          )}`,
        });
      else messages.push({ role: 'assistant', content: message.content });
    }
    return messages;
  }

  private streamMessage(run: Run): {
    message: Message;
    append: (text: string, reasoning?: boolean) => void;
  } {
    const message = this.store.message(run.chatId, run.id, 'assistant', '', { streaming: true });
    this.events.publish('state');
    return {
      message,
      append: (text: string, reasoning = false) => {
        if (reasoning) message.metadata.reasoning = String(message.metadata.reasoning ?? '') + text;
        else message.content += text;
        this.store.put('message', message);
        this.events.publish(
          'text',
          { id: message.id, content: message.content, reasoning: message.metadata.reasoning },
          run.workspaceId,
          run.id,
        );
      },
    };
  }

  /** A provider's model without BasedCode tools, for one-off text work such as compaction summaries. */
  private async plainModel(
    provider: ProviderConfig,
    workspace: Workspace,
  ): Promise<{ model: LanguageModel; finish: () => Promise<void> }> {
    const global = this.store.global();
    const env: Record<string, string | undefined> = {
      ...process.env,
      BASEDCODE_AUTH: undefined,
      BASEDCODE_API: undefined,
    };
    if (provider.kind === 'claude') {
      return {
        finish: async () => undefined,
        model: createClaudeCode().languageModel(provider.model || 'default', {
          cwd: workspace.path,
          pathToClaudeCodeExecutable: cliPath('claude', global.claudePath),
          tools: [],
          settingSources: [],
          plugins: [],
          hooks: {},
          persistSession: false,
          strictMcpConfig: true,
          maxTurns: 1,
          logger: false,
          env,
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'No tools are available while compacting.',
          }),
        }),
      };
    }
    if (provider.kind === 'codex') {
      const codexEnv = await this.codexEnvironment(env);
      return {
        finish: codexEnv.finish,
        model: createCodexExec().languageModel(provider.model, {
          cwd: workspace.path,
          codexPath: cliPath('codex', global.codexPath),
          approvalMode: 'never',
          sandboxMode: 'read-only',
          skipGitRepoCheck: true,
          color: 'never',
          webSearch: false,
          logger: false,
          env: codexEnv.env,
          configOverrides: {
            web_search: 'disabled',
            include_apply_patch_tool: false,
            ...Object.fromEntries(
              codexDisabledFeatures.map((feature) => [`features.${feature}`, false]),
            ),
          },
        }),
      };
    }
    throw new Error('Use localModel for local providers.');
  }

  private async localModel(provider: ProviderConfig): Promise<LanguageModel> {
    if (!provider.model)
      throw new Error(`Choose a ${provider.kind} model with the model picker below the composer.`);
    if (provider.kind === 'antigravity') {
      const effort = provider.effort || undefined;
      if (effort !== undefined && effort !== 'low' && effort !== 'medium' && effort !== 'high')
        throw new Error('Antigravity reasoning effort must be low, medium or high.');
      return antigravity(provider.model, {
        ...antigravityOptions(this.store.global().antigravityPath),
        effort,
      });
    }
    const url = new URL(provider.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Provider endpoint must be HTTP(S) without embedded credentials.');
    const model = createOpenAI({
      baseURL: provider.endpoint,
      apiKey: (await this.credentials.get(provider.id)) ?? 'local',
      fetch: provider.effort === reasoningOff ? withoutReasoning(provider.kind) : reasoningFetch,
    }).chat(provider.model);
    return wrapLanguageModel({
      model,
      middleware: extractReasoningMiddleware({ tagName: 'think', separator: '' }),
    });
  }

  /**
   * Replaces older conversation with a model-written summary when the estimated prompt passes the configured threshold
   * (or always, when forced). The last few messages and the current prompt stay verbatim. The original messages remain
   * stored and visible; only what the model receives changes, and the chat shows that a lossy compaction happened.
   */
  async compact(
    chatId: string,
    provider: ProviderConfig,
    workspace: Workspace,
    signal?: AbortSignal,
    runId?: string,
    force = false,
  ): Promise<boolean> {
    if (this.compacting.has(chatId)) throw new Error('This chat is already compacting.');
    this.compacting.set(chatId, workspace);
    try {
      return await this.compactContext(chatId, provider, workspace, signal, runId, force);
    } finally {
      this.compacting.delete(chatId);
      this.events.publish('state');
      void this.pump();
    }
  }

  private async compactContext(
    chatId: string,
    provider: ProviderConfig,
    workspace: Workspace,
    signal?: AbortSignal,
    runId?: string,
    force = false,
  ): Promise<boolean> {
    const settings = this.store.global().compaction;
    if (!force && !settings.enabled) return false;
    const history = this.history(chatId, runId);
    const target = runId
      ? this.store.get('run', runId)
      : this.store
          .all('run')
          .filter((run) => run.chatId === chatId && !run.reverted)
          .at(-1);
    if (!target) return false;
    const before = estimateTokens(this.transcript(chatId, target.id));
    if (!force && before < settings.thresholdTokens) return false;
    const previous = history.findLast((message) => message.metadata.compaction)?.metadata
      .compaction as { summary: string; through: string } | undefined;
    const start = previous
      ? history.findIndex((message) => message.id === previous.through) + 1
      : 0;
    // Older steps of the active run must also be eligible during long tool loops.
    const keepFrom = Math.max(start, history.length - 6);
    const older = history
      .slice(start, keepFrom)
      .filter(
        (message) =>
          !message.metadata.compaction && !message.metadata.pinned && !message.metadata.excluded,
      );
    if (older.length < 4) {
      if (force) throw new Error('There is not enough older conversation to compact yet.');
      return false;
    }
    const { model, finish } =
      provider.kind === 'codex' || provider.kind === 'claude'
        ? await this.plainModel(provider, workspace)
        : { model: await this.localModel(provider), finish: async () => undefined };
    const text = older
      .map((message) =>
        message.role === 'tool'
          ? `TOOL ${JSON.stringify(message.metadata.tool).slice(0, 4000)}`
          : `${message.role.toUpperCase()}: ${message.content}${(message.metadata.attachments as Attachment[] | undefined)?.length ? ` [attachments: ${(message.metadata.attachments as Attachment[]).map((item) => item.name).join(', ')}]` : ''}`,
      )
      .join('\n\n');
    const pending = this.store.message(chatId, target.id, 'system', 'compacting...', {
      compacting: true,
    });
    this.events.publish('state');
    try {
      const result = await generateText({
        model,
        instructions: compactionPrompt,
        abortSignal: signal,
        maxRetries: 1,
        prompt: `${previous ? `Earlier summary to fold in:\n${previous.summary}\n\n` : ''}Conversation to summarize:\n\n${text}`,
      });
      if (!result.text.trim())
        throw new Error('The model returned an empty summary; nothing was compacted.');
      const through = older.at(-1)!.id;
      const marker = this.store.put('message', {
        ...pending,
        content: '',
        metadata: {
          compaction: {
            summary: result.text.trim(),
            through,
            messages: older.length,
            tokensBefore: before,
          },
        },
      });
      const after = estimateTokens(this.transcript(chatId, target.id));
      this.store.put('message', {
        ...marker,
        content: `Context compacted: ${older.length} earlier messages summarized by ${provider.kind} / ${provider.model || 'default'} (≈${before.toLocaleString()} → ≈${after.toLocaleString()} tokens). The summary is lossy; the original messages stay in this chat but are no longer sent to the model.`,
      });
      this.events.publish('state');
      return true;
    } catch (error) {
      this.store.put('message', {
        ...pending,
        content: `Compaction failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { error: true },
      });
      throw error;
    } finally {
      await finish();
    }
  }

  private async execute(
    workspace: Workspace,
    run: Run,
    controller: AbortController,
  ): Promise<void> {
    const signal = controller.signal;
    let checkpointStarted = false;
    try {
      const chat = this.store.get('chat', run.chatId);
      this.store.put('chat', { ...chat, stale: false });
      const coverageWarnings = await this.checkpoints.coverageWarnings(workspace);
      if (coverageWarnings.length)
        this.events.publish(
          'checkpoint-warning',
          `Prompt revert cannot restore excluded, linked, or oversized paths: ${coverageWarnings.slice(0, 12).join(', ')}${coverageWarnings.length > 12 ? `, and ${coverageWarnings.length - 12} more` : ''}.`,
          workspace.id,
          run.id,
        );
      if (this.checkpoints.hasRecovery)
        throw new Error('Resolve the interrupted restore before starting another task.');
      // A workspace too large to snapshot still runs; it just loses prompt revert for this run.
      try {
        await this.checkpoints.begin(workspace, run.id);
        checkpointStarted = true;
      } catch (error) {
        this.events.publish(
          'checkpoint-warning',
          `No checkpoint for this prompt, so it cannot be reverted: ${error instanceof Error ? error.message : String(error)}`,
          workspace.id,
          run.id,
        );
      }
      this.update(run, { status: 'running' });
      const runChat = this.store.get('chat', run.chatId);
      const reviewing = runChat.mode === 'review';
      const providers = this.providerOrder(workspace, runChat);
      if (!providers.length)
        throw new Error(
          "Enable at least one provider in app settings, or in this workspace's fallback order.",
        );
      const allTools = this.tools.definitions({
        workspace,
        run,
        signal,
        // Snapshot before every call that can change files, so the run can be rewound to just before it.
        beforeTool: async (name, messageId) => {
          if (!checkpointStarted || !fileChangingTools.has(name)) return;
          await this.checkpoints.snapshotTool(workspace, run.id, messageId).catch(() => undefined);
        },
      });
      // Guard first, so budgets, loop detection and the secret guard also cover tools reached through call_tool.
      const { offered: definitions, catalog } = this.offerTools(
        this.guardTools(
          reviewing ? allTools.filter((item) => readOnlyTools.has(item.name)) : allTools,
          workspace,
          run,
          controller,
        ),
        runChat,
        workspace,
      );
      const projectFiles = await loadInstructions(workspace.path);
      if (projectFiles.length) {
        this.update(run, { instructionFiles: projectFiles.map((file) => file.label) });
        this.store.message(
          run.chatId,
          run.id,
          'system',
          `Project instructions applied: ${projectFiles.map((file) => `${file.label}${file.truncated ? ' (truncated)' : ''}`).join(', ')}`,
          { instructions: projectFiles.map((file) => file.label) },
        );
      }
      const instructions = this.instructionParts(workspace, run.chatId, projectFiles, catalog)
        .map((part) => part.text)
        .join('');
      const entry = this.active.get(run.id);
      let completed = false;
      // The provider that finished the task; a fix-up round after failed checks goes back to it.
      let finisher: ProviderConfig | undefined;
      for (let index = 0; index < providers.length; index++) {
        const provider = providers[index];
        if (index > 0 && provider.requireConsent)
          await this.permissions.ask(
            workspace.id,
            'Provider fallback consent',
            `Send conversation and workspace context to ${providerName(provider)} / ${provider.model}.`,
            signal,
            run,
          );
        this.update(run, {
          provider: `${providerName(provider)} / ${provider.model || 'default'}`,
          providerIndex: index,
        });
        if (entry) {
          entry.kind = provider.kind;
          entry.injector = undefined;
        }
        let compactedForOverflow = false;
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          try {
            await this.compact(run.chatId, provider, workspace, signal, run.id).catch(
              (error: unknown) => {
                signal.throwIfAborted();
                this.store.message(
                  run.chatId,
                  run.id,
                  'system',
                  `Context compaction failed: ${error instanceof Error ? error.message : String(error)}. Continuing with the full conversation.`,
                  { error: true },
                );
              },
            );
            if (provider.kind === 'codex' || provider.kind === 'claude')
              await this.subscription(provider, workspace, run, signal, definitions, instructions);
            else await this.local(provider, run, signal, definitions, instructions);
            completed = true;
            finisher = provider;
            break;
          } catch (error) {
            signal.throwIfAborted();
            // A context overflow gets one forced compaction and a retry; the work done so far is in the transcript.
            if (
              !compactedForOverflow &&
              error instanceof Error &&
              contextOverflowText.test(error.message)
            ) {
              compactedForOverflow = true;
              this.store.message(
                run.chatId,
                run.id,
                'system',
                "The conversation exceeded the model's context window. Compacting and retrying.",
              );
              if (
                await this.compact(run.chatId, provider, workspace, signal, run.id, true).catch(
                  () => false,
                )
              )
                continue;
            }
            const kind =
              provider.kind === 'antigravity' &&
              error instanceof AgyError &&
              usageLimitText.test(error.message)
              ? 'quota'
              : failureKind(error);
            if (kind === 'transient' && attempt < maxTransientRetries) {
              // Connection drops and rate limits are retried with backoff; usage exhaustion never is (kind 'quota').
              const wait = retryDelayMs(attempt, error);
              this.store.message(
                run.chatId,
                run.id,
                'system',
                `Lost the connection to the model (${error instanceof Error ? error.message : String(error)}). Reconnecting in ${Math.ceil(wait / 1000)}s (attempt ${attempt + 1}/${maxTransientRetries}).`,
                { reconnecting: true },
              );
              this.update(run, {
                reconnecting: {
                  attempt: attempt + 1,
                  max: maxTransientRetries,
                  until: new Date(Date.now() + wait).toISOString(),
                },
              });
              await delay(wait, undefined, { signal });
              this.update(run, { reconnecting: undefined });
              continue;
            }
            if (kind !== 'quota') throw error;
            this.store.message(
              run.chatId,
              run.id,
              'system',
              `Confirmed usage exhaustion for ${provider.kind}. ${index + 1 < providers.length ? 'Continuing with the next configured provider.' : 'No fallback providers remain.'}`,
            );
            this.events.publish('state');
            break;
          } finally {
            if (provider.kind === 'antigravity')
              void this.limits.refreshAntigravity(this.store.global().antigravityPath).catch(() => undefined);
          }
        }
        if (completed) break;
      }
      if (!completed) throw new Error('Usage limits exhausted the configured provider list.');
      const commandResults = this.store
        .all('message')
        .filter(
          (message) =>
            message.runId === run.id &&
            message.role === 'tool' &&
            message.content === 'run_command',
        );
      let checks = reviewing ? [] : await this.verify(workspace, run, signal);
      if (
        finisher &&
        !reviewing &&
        effectiveFixFailedChecks(this.store.global(), workspace) &&
        checks.some((check) => check.status === 'failed')
      ) {
        const failures = checks
          .filter((check) => check.status === 'failed')
          .map(
            (check) =>
              `## ${check.name} (${check.command}, exit ${check.exitCode})\n${check.output ?? ''}`,
          )
          .join('\n\n');
        this.store.message(
          run.chatId,
          run.id,
          'system',
          `Verification checks failed. Handing the failures back to the model for one fix-up round.\n\n${failures}`,
          { fixup: true },
        );
        if (finisher.kind === 'codex' || finisher.kind === 'claude')
          await this.subscription(finisher, workspace, run, signal, definitions, instructions);
        else await this.local(finisher, run, signal, definitions, instructions);
        checks = await this.verify(workspace, run, signal);
      }
      for (const check of checks) delete check.output;
      const summary = checks.length
        ? checks
            .map(
              (check) =>
                `${check.status === 'passed' ? '✓' : check.status === 'failed' ? '✗' : '–'} ${check.name}: ${check.status}${check.exitCode !== undefined ? ` (exit ${check.exitCode})` : ''}`,
            )
            .join('\n')
        : 'No verification checks are configured for this workspace.';
      const failed = checks.filter((check) => check.status === 'failed').length;
      this.store.message(
        run.chatId,
        run.id,
        'system',
        `Agent finished. ${commandResults.length ? `${commandResults.length} agent terminal command(s) recorded.` : 'The agent ran no terminal commands.'}\n${summary}`,
        { completion: true, checks, error: failed > 0 },
      );
      this.update(run, { status: 'completed' });
    } catch (error) {
      const stalled = this.active.get(run.id)?.stalled;
      const reason: unknown = stalled ? signal.reason : error;
      this.update(run, {
        reconnecting: undefined,
        status: stalled ? 'interrupted' : signal.aborted ? 'cancelled' : 'failed',
        error: reason instanceof Error ? reason.message : String(reason),
      });
      this.store.message(run.chatId, run.id, 'system', run.error ?? 'Execution stopped.', {
        error: true,
      });
    } finally {
      // End run-scoped resources, including any browser session, after all provider work.
      controller.abort();
      if (checkpointStarted) {
        try {
          await this.checkpoints.finish(workspace, run.id);
        } catch (error) {
          this.update(run, {
            status: 'failed',
            error: `Could not finalize checkpoint: ${error instanceof Error ? error.message : String(error)}. Inspect files before reverting.`,
          });
        }
      }
      for (const message of this.store
        .all('message')
        .filter((message) => message.runId === run.id && message.metadata.streaming)) {
        this.store.put('message', {
          ...message,
          metadata: { ...message.metadata, streaming: false },
        });
      }
      this.events.publish('state');
    }
  }

  /**
   * One-off text from the model a chat (or, without one, the workspace) would use next, with no tools: commit
   * messages and the like. Returns the text and the model that wrote it.
   */
  async writeText(
    workspace: Workspace,
    chatId: string | undefined,
    system: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<{ text: string; model: string }> {
    const provider = chatId
      ? this.providerOrder(workspace, this.store.get('chat', chatId))[0]
      : effectiveProviders(this.store.global(), workspace).find((item) => item.enabled);
    if (!provider) throw new Error('Enable a model connection first.');
    const { model, finish } =
      provider.kind === 'codex' || provider.kind === 'claude'
        ? await this.plainModel(provider, workspace)
        : { model: await this.localModel(provider), finish: async () => undefined };
    try {
      const result = await generateText({
        model,
        instructions: system,
        prompt,
        abortSignal: signal,
        maxRetries: 1,
      });
      return { text: result.text.trim(), model: `${providerName(provider)} / ${provider.model || 'default'}` };
    } finally {
      await finish();
    }
  }

  /**
   * Providers for a run, in order. A chat set to a provider (by "Continue with", a review or a re-run) puts it
   * first; reviews and re-runs use only that provider, so the comparison stays honest.
   */
  private providerOrder(workspace: Workspace, chat: Chat): ProviderConfig[] {
    const global = this.store.global();
    const order = effectiveProviders(global, workspace);
    if (!chat.providerId) return order.filter((provider) => provider.enabled);
    const pinned = global.providers.find((provider) => provider.id === chat.providerId);
    if (!pinned)
      throw new Error(
        'The model this chat was set to no longer exists. Pick another with "Continue with".',
      );
    const chosen = {
      ...pinned,
      enabled: true,
      model: chat.model || pinned.model,
      effort: chat.model || chat.effort !== undefined ? chat.effort : pinned.effort,
    };
    if (chat.mode === 'review' || chat.rerunOf) return [chosen];
    return [
      chosen,
      ...order.filter((provider) => provider.enabled && provider.id !== pinned.id),
    ];
  }

  /**
   * The tools a run sends to the model. Rarely used groups are deferred behind load_tools/call_tool unless the user
   * turned that off; a tool named in the chat's mode prompt or the workspace instructions stays loaded.
   */
  private offerTools(definitions: ToolDefinition[], chat: Chat, workspace: Workspace): OfferedTools {
    if (this.store.global().deferTools === false) return { offered: definitions, catalog: '' };
    const pinned = `${guidedMode(chat.mode)?.prompt ?? ''}\n${workspace.settings.instructions ?? ''}`;
    return deferTools(definitions, (name) => pinned.includes(name));
  }

  /** The system prompt for a run in a chat, as labelled parts. Joined, they are exactly what the model receives. */
  private instructionParts(
    workspace: Workspace,
    chatId: string,
    projectFiles: InstructionFile[],
    toolCatalog = '',
  ): { label: string; text: string }[] {
    const chat = this.store.get('chat', chatId);
    const remainingActions = this.store
      .all('action')
      .filter((action) => action.workspaceId === workspace.id && action.reverted)
      .map((action) => `${action.title}${action.detail ? ` (${action.detail.slice(0, 160)})` : ''}`);
    const checks = workspace.settings.checks
      .filter((check) => check.command.trim())
      .map((check) => `${check.name}: ${check.command}`);
    const reviews =
      chat.mode === 'review'
        ? []
        : secondOpinions(this.store, chatId).filter((item) => item.review);
    const files = projectFiles.map((file) => file.label).join(', ');
    const parts: ({ label: string; text: string } | false)[] = [
      { label: 'BasedCode system prompt', text: personalizedSystemPrompt(this.store.global().profile) },
      Boolean(toolCatalog) && { label: 'Deferred tool catalog', text: `\n\n${toolCatalog}` },
      Boolean(workspace.scratch) && { label: 'Plain chat note', text: `\n\n${scratchPrompt}` },
      ...guidedModePart(chat.mode),
      chat.mode === 'review' && { label: 'Second opinion mode', text: `\n\n${reviewPrompt}` },
      !chat.titleSource && {
        label: 'Chat title note',
        text: `\n\nThis chat has no real title yet (it shows "${chat.title.slice(0, 80)}"). Call set_chat_title once, early, with a short title for it.`,
      },
      Boolean(workspace.settings.instructions?.trim()) && {
        label: 'Workspace instructions',
        text: `\n\n# Workspace instructions from the user\n${workspace.settings.instructions?.trim()}`,
      },
      reviews.length > 0 && {
        label: 'Second opinions note',
        text: `\n\nThe user asked other models for second opinions on this chat (${reviews.map((item) => `${item.reviewId} by ${item.reviewer}`).join('; ')}). Read them with second_opinions when the user refers to them, and verify their claims against the code before acting.`,
      },
      {
        label: 'Workspace, checks and remaining actions',
        text: `\n\nWorkspace: ${workspace.path}\nConfigured checks (run_checks): ${checks.join('; ') || 'none'}${remainingActions.length ? `\nActions from reverted prompts whose effects remain: ${remainingActions.slice(-20).join('; ')}` : ''}`,
      },
      {
        label: files ? `Project instructions (${files})` : 'Project instructions',
        text: `\n\n${instructionsPrompt(projectFiles)}`,
      },
    ];
    return parts.filter((part): part is { label: string; text: string } => Boolean(part));
  }

  /**
   * What the next prompt in a chat would send to the model, with estimated token counts: system prompt parts, tool
   * definitions and each conversation message, with its pin and exclude state, for the context inspector.
   */
  async inspectContext(chatId: string): Promise<{
    provider?: string;
    threshold: number;
    system: { label: string; tokens: number }[];
    tools: { name: string; tokens: number }[];
    messages: {
      id: string;
      role: Message['role'];
      label: string;
      tokens: number;
      pinned: boolean;
      excluded: boolean;
      compacted: boolean;
    }[];
  }> {
    const chat = this.store.get('chat', chatId);
    const workspace = this.store.get('workspace', chat.workspaceId);
    const projectFiles = await loadInstructions(workspace.path);
    const reviewing = chat.mode === 'review';
    const { offered, catalog } = this.offerTools(
      this.tools
        .definitions({
          workspace,
          run: { id: '', chatId } as Run,
          signal: new AbortController().signal,
        })
        .filter((definition) => !reviewing || readOnlyTools.has(definition.name)),
      chat,
      workspace,
    );
    const system = this.instructionParts(workspace, chatId, projectFiles, catalog).map(
      (part) => ({
        label: part.label,
        tokens: estimateTokens([{ role: 'system', content: part.text }]),
      }),
    );
    const tools = offered
      .map((definition) => ({
        name: definition.name,
        tokens: estimateTokens([
          {
            role: 'system',
            content:
              definition.name +
              definition.description +
              schemaText(definition),
          },
        ]),
      }));
    const history = this.history(chatId);
    const compaction = history.findLast((message) => message.metadata.compaction)?.metadata
      .compaction as { summary: string; through: string } | undefined;
    const through = compaction
      ? history.findIndex((message) => message.id === compaction.through)
      : -1;
    const messages = history
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => !(message.role === 'system' && message.metadata.completion))
      .map(({ message, index }) => {
        const tool = message.metadata.tool as
          | { name?: string; args?: Record<string, unknown> }
          | undefined;
        const content =
          message.role === 'tool'
            ? JSON.stringify(message.metadata.tool)
            : message.metadata.compaction
              ? (compaction?.summary ?? '')
              : message.content;
        const subject =
          message.role === 'tool'
            ? `${tool?.name ?? 'tool'} ${String(tool?.args?.path ?? tool?.args?.command ?? tool?.args?.query ?? tool?.args?.url ?? '').slice(0, 80)}`
            : message.metadata.compaction
              ? 'Compaction summary'
              : message.content.replace(/\s+/g, ' ').slice(0, 90);
        return {
          id: message.id,
          role: message.role,
          label: subject.trim(),
          tokens: estimateTokens([{ role: 'user', content }]),
          pinned: Boolean(message.metadata.pinned),
          excluded: Boolean(message.metadata.excluded),
          compacted: !message.metadata.compaction && index <= through && !message.metadata.pinned,
        };
      });
    const provider = this.providerOrder(workspace, chat)[0];
    return {
      provider: provider ? `${providerName(provider)} / ${provider.model || 'default'}` : undefined,
      threshold: this.store.global().compaction.thresholdTokens,
      system,
      tools,
      messages,
    };
  }

  /**
   * Runs the workspace's configured lint/type-check/test commands after the agent finishes, with one approval for the set.
   * Agent completion and check results stay separate: a denied or refused approval reports every check as skipped, not passed.
   */
  private async verify(
    workspace: Workspace,
    run: Run,
    signal: AbortSignal,
  ): Promise<
    {
      name: string;
      command: string;
      status: 'passed' | 'failed' | 'skipped';
      exitCode?: number;
      terminalId?: string;
      output?: string;
    }[]
  > {
    const checks = workspace.settings.checks.filter((check) => check.command.trim());
    if (!checks.length) return [];
    try {
      await this.permissions.ask(
        workspace.id,
        'Run verification checks',
        `${checks.map((check) => `${check.name}: ${check.command}`).join('\n')}\n\nFolder: ${workspace.path}\n${this.processes.sandbox.detail}\nDeny to skip checks; skipped checks are reported as skipped, not passed.`,
        signal,
        run,
      );
    } catch {
      signal.throwIfAborted();
      return checks.map((check) => ({ ...check, status: 'skipped' }));
    }
    const results = [];
    for (const check of checks) {
      const action = this.store.action(
        workspace.id,
        `Check: ${check.name}`,
        `${check.command}\nMay affect uncaptured files or external systems.`,
        run,
      );
      try {
        const result = (await this.processes.command(
          workspace,
          check.command,
          run,
          signal,
          false,
          false,
        )) as { terminalId: string; exitCode: number; output: string };
        this.store.put('action', { ...action, status: 'completed' });
        results.push({
          ...check,
          status: result.exitCode === 0 ? ('passed' as const) : ('failed' as const),
          exitCode: result.exitCode,
          terminalId: result.terminalId,
          output: cleanOutput(result.output).slice(-4_000),
        });
      } catch (error) {
        this.store.put('action', { ...action, status: 'unknown' });
        throw error;
      }
    }
    return results;
  }

  /**
   * Wraps the run's tools with the run budget and loop detection. Before each call the budget is checked against the run's
   * stats; reaching a limit pauses on an approval card, where approving raises that limit by its original size. An identical
   * call that keeps failing gets a stronger error on its third failure and pauses the run on the fourth.
   */
  private guardTools(
    definitions: ToolDefinition[],
    workspace: Workspace,
    run: Run,
    controller: AbortController,
  ): ToolDefinition[] {
    const signal = controller.signal;
    const budget = effectiveBudget(this.store.global(), workspace);
    const limits = { ...budget };
    let calls = 0;
    const failures = new Map<string, number>();
    const pause = async (title: string, detail: string, stopped: string) => {
      try {
        await this.permissions.ask(workspace.id, title, detail, signal, run);
      } catch (error) {
        signal.throwIfAborted();
        controller.abort(new Error(stopped));
        throw error;
      }
    };
    // Warn once per limit (and again after a raised limit) when a run passes 80% of it.
    const warned = new Set<string>();
    const warn = (kind: string, used: number, limit: number | undefined, text: string) => {
      if (limit === undefined || used < limit * 0.8 || used >= limit) return;
      const key = `${kind}:${limit}`;
      if (warned.has(key)) return;
      warned.add(key);
      this.store.message(
        run.chatId,
        run.id,
        'system',
        `This run has used ${Math.floor((used / limit) * 100)}% of its ${text}. It will pause for your approval at the limit.`,
        { budgetWarning: true },
      );
      this.events.publish('state');
    };
    const checkBudget = async () => {
      const tokens = (run.stats?.inputTokens ?? 0) + (run.stats?.outputTokens ?? 0);
      const cost = run.stats?.costUsd ?? 0;
      warn('calls', calls, limits.maxToolCalls, `tool call budget (${calls} of ${limits.maxToolCalls})`);
      warn('tokens', tokens, limits.maxTokens, `token budget (${tokens.toLocaleString()} of ${limits.maxTokens?.toLocaleString()})`);
      warn('cost', cost, limits.maxCostUsd, `cost budget ($${cost.toFixed(2)} of $${limits.maxCostUsd?.toFixed(2)})`);
      const over = {
        calls: limits.maxToolCalls !== undefined && calls >= limits.maxToolCalls,
        tokens: limits.maxTokens !== undefined && tokens >= limits.maxTokens,
        cost: limits.maxCostUsd !== undefined && cost >= limits.maxCostUsd,
      };
      const reached = [
        over.calls ? `${calls} tool calls (limit ${limits.maxToolCalls})` : '',
        over.tokens
          ? `${tokens.toLocaleString()} tokens (limit ${limits.maxTokens!.toLocaleString()})`
          : '',
        over.cost ? `$${cost.toFixed(2)} (limit $${limits.maxCostUsd!.toFixed(2)})` : '',
      ].filter(Boolean);
      if (!reached.length) return;
      await pause(
        'Run budget reached',
        `This run has used ${reached.join(', ')}.\n\nApprove to continue with the reached limits raised by the same amount again. Deny to stop the run; work so far is kept and can be reverted.\nChange the budget in workspace settings → Providers → Run budget.`,
        `Stopped at the run budget: ${reached.join(', ')}.`,
      );
      if (over.calls) limits.maxToolCalls! += budget.maxToolCalls!;
      if (over.tokens) limits.maxTokens! += budget.maxTokens!;
      if (over.cost) limits.maxCostUsd! += budget.maxCostUsd!;
    };
    // Values known to be secret: .env entries and saved provider credentials. Loaded once, on the first outbound call.
    let known: Promise<{ name: string; value: string }[]> | undefined;
    const knownSecrets = () =>
      (known ??= (async () => {
        const providers = this.store.global().providers;
        const saved = await Promise.all(
          providers.map(async (provider) => ({
            name: `${providerName(provider)} credential`,
            value: (await this.credentials.get(provider.id).catch(() => undefined)) ?? '',
          })),
        );
        return [...(await envSecrets(workspace.path)), ...saved.filter((item) => item.value)];
      })());
    const guardSecrets = async (name: string, args: Record<string, unknown>) => {
      if (this.store.global().secretGuard === false || !isOutboundTool(name)) return;
      const found = findSecrets(JSON.stringify(args), await knownSecrets());
      if (!found.length) return;
      try {
        await this.permissions.ask(
          workspace.id,
          'Possible secret in outbound call',
          `The agent's ${name} call contains what looks like ${found.map((item) => `${item.kind} (${item.redacted})`).join(', ')}.\n\nThis call can send data off this machine. Approve only if sending it is intended. Deny to refuse the call; the agent is told why.\nTurn this check off in app settings → Run policies.`,
          signal,
          run,
        );
      } catch (error) {
        signal.throwIfAborted();
        throw new Error(
          `Refused: this ${name} call contained a likely secret (${found.map((item) => item.kind).join(', ')}) and the user did not approve sending it. Do not retry with the secret; ask the user how they want it handled.`,
          { cause: error },
        );
      }
    };
    return definitions.map((definition) => ({
      ...definition,
      execute: async (args: Record<string, unknown>) => {
        await checkBudget();
        await guardSecrets(definition.name, args);
        calls++;
        const key = `${definition.name}\n${JSON.stringify(args)}`;
        try {
          const result = await definition.execute(args);
          failures.delete(key);
          return result;
        } catch (error) {
          signal.throwIfAborted();
          const count = (failures.get(key) ?? 0) + 1;
          failures.set(key, count);
          const message = error instanceof Error ? error.message : String(error);
          if (count === 3)
            throw new Error(
              `${message}\n\nThis identical ${definition.name} call has now failed 3 times. Do not repeat it: read the error, change the arguments or the approach, or stop and ask the user.`,
            );
          if (count >= 4) {
            await pause(
              'Repeated failing tool call',
              `The agent called ${definition.name} with identical arguments ${count} times and it failed each time:\n${message}\n\nApprove to let it continue. Deny to stop the run.`,
              `Stopped: ${definition.name} kept failing with identical arguments.`,
            );
            failures.delete(key);
          }
          throw error;
        }
      },
    }));
  }

  /** Accumulates generation stats over a provider's model calls and keeps them on the run record. */
  private recorder(run: Run, provider: ProviderConfig) {
    // A retry or fix-up round on the same model keeps adding to its stats, so budgets see the whole run.
    const previous =
      run.stats?.provider === provider.kind && run.stats.model === (provider.model || 'default')
        ? run.stats
        : undefined;
    const stats: RunStats = previous
      ? { ...previous }
      : {
          provider: provider.kind,
          model: provider.model || 'default',
          steps: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          promptMs: 0,
          generationMs: 0,
          totalMs: 0,
          estimated: false,
        };
    const started = performance.now() - stats.totalMs;
    let lastSave = 0;
    const save = (provisional?: Partial<RunStats>) => {
      stats.totalMs = Math.round(performance.now() - started);
      lastSave = performance.now();
      this.update(run, { stats: { ...stats, ...provisional } });
    };
    return { stats, save, due: () => performance.now() - lastSave > 1000 };
  }

  private async local(
    provider: ProviderConfig,
    run: Run,
    signal: AbortSignal,
    definitions: ToolDefinition[],
    instructions: string,
  ): Promise<void> {
    const model = await this.localModel(provider);
    // Fail clearly when the configured model is not installed; the raw API answer is just "Not Found".
    const apiKey = await this.credentials.get(provider.id);
    const listing =
      provider.kind === 'antigravity'
        ? undefined
        : await fetch(provider.endpoint.replace(/\/$/, '') + '/models', {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          })
            .then((response) =>
              response.ok ? (response.json() as Promise<{ data?: { id: string }[] }>) : undefined,
            )
            .catch(() => {
              throw new Error(
                `${provider.kind} is not reachable at ${provider.endpoint}. Start it, or pick another model.`,
              );
            });
    const installed = listing?.data?.map((model) => model.id);
    if (installed && !installed.includes(provider.model))
      throw new Error(
        `Model "${provider.model}" is not installed in ${provider.kind}. Pick an installed model with the model picker.`,
      );
    const tools: ToolSet = Object.fromEntries(
      definitions.map((definition) => [
        definition.name,
        tool({
          description: definition.description,
          inputSchema: inputSchema(definition.shape),
          execute: definition.execute,
          toModelOutput: ({ output }: { output: unknown }) =>
            isImageResult(output)
              ? {
                  type: 'content' as const,
                  value: [
                    { type: 'text' as const, text: imageCaption(output) },
                    ...resultImages(output).map((image) => ({
                      type: 'image-data' as const,
                      data: image.data,
                      mediaType: image.mediaType,
                    })),
                  ],
                }
              : typeof output === 'string'
                ? { type: 'text' as const, value: output }
                : { type: 'json' as const, value: (output ?? null) as JSONValue },
        }),
      ]),
    );
    let messages = this.transcript(run.chatId, run.id);
    const inbox = this.active.get(run.id)?.inbox ?? [];
    let recoveries = 0;
    const { stats, save, due } = this.recorder(run, provider);
    for (;;) {
      signal.throwIfAborted();
      while (this.processes.hasTakeover(run.id)) await delay(150, undefined, { signal });
      try {
        if (
          await this.compact(
            run.chatId,
            provider,
            this.store.get('workspace', run.workspaceId),
            signal,
            run.id,
          )
        ) {
          messages = this.transcript(run.chatId, run.id);
          // The rebuilt transcript already includes persisted steering messages.
          inbox.splice(0);
        }
      } catch (error) {
        signal.throwIfAborted();
        this.store.message(
          run.chatId,
          run.id,
          'system',
          `Context compaction failed: ${error instanceof Error ? error.message : String(error)}. Continuing with the full conversation.`,
          { error: true },
        );
      }
      // Steering messages join the conversation before the next model call.
      messages.push(...inbox.splice(0));
      const stream = this.streamMessage(run);
      const requested = performance.now();
      let firstToken: number | undefined;
      let lastToken = requested;
      let chunks = 0;
      const result = streamText({
        model,
        instructions,
        messages,
        tools,
        abortSignal: signal,
        maxRetries: 0,
      });
      for await (const part of result.stream) {
        if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
          firstToken ??= performance.now();
          lastToken = performance.now();
          chunks++;
          // Live speed while streaming, from chunk counts; replaced by reported usage when the call ends.
          if (due())
            save({
              outputTokens: stats.outputTokens + chunks,
              generationMs: stats.generationMs + (lastToken - firstToken),
              estimated: true,
            });
        }
        if (part.type === 'text-delta') stream.append(part.text);
        if (part.type === 'reasoning-delta') stream.append(part.text, true);
        if (part.type === 'tool-call') stats.toolCalls++;
        if (part.type === 'error') throw part.error;
      }
      const response = await result.response;
      if (!stream.message.metadata.reasoning) {
        const reasoning = await result.reasoningText;
        if (reasoning) stream.append(reasoning, true);
      }
      const usage = await result.usage;
      stats.steps++;
      stats.ttftMs ??= firstToken === undefined ? undefined : Math.round(firstToken - requested);
      stats.promptMs += Math.round((firstToken ?? lastToken) - requested);
      stats.generationMs += Math.round(firstToken === undefined ? 0 : lastToken - firstToken);
      stats.inputTokens += usage.inputTokens ?? 0;
      stats.reasoningTokens += usage.outputTokenDetails?.reasoningTokens ?? 0;
      if (usage.outputTokens === undefined) stats.estimated = true;
      stats.outputTokens += usage.outputTokens ?? chunks;
      const stepCost = estimateCost(provider.kind, provider.model, {
        inputTokens: usage.inputTokens ?? 0,
        cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        outputTokens: usage.outputTokens ?? chunks,
      });
      if (stepCost !== undefined) {
        stats.costUsd = (stats.costUsd ?? 0) + stepCost;
        stats.costEstimated = true;
      }
      save();
      messages.push(...response.messages);
      this.store.put('message', {
        ...stream.message,
        metadata: { ...stream.message.metadata, streaming: false },
      });
      signal.throwIfAborted();
      const calls = (await result.toolCalls).length;
      const continuation = localStep(
        await result.finishReason,
        await result.text,
        calls,
        recoveries,
      );
      if (calls) recoveries = 0;
      else if (continuation !== undefined) recoveries++;
      if (continuation) messages.push({ role: 'user', content: continuation });
      // A steering message that arrived during the final answer still deserves a reply.
      if (continuation === undefined && !inbox.length) return;
    }
  }

  /**
   * Codex and Claude Code through their AI SDK providers. Each CLI runs its own agent loop, so BasedCode tools reach it as an
   * MCP server and every native operational tool is switched off in the CLI options. The stream guard is the enforcement:
   * any provider-executed tool call that is not a BasedCode tool aborts the run and fails it.
   */
  private async subscription(
    provider: ProviderConfig,
    workspace: Workspace,
    run: Run,
    signal: AbortSignal,
    definitions: ToolDefinition[],
    instructions: string,
  ): Promise<void> {
    const screenshotsBefore = new Set(this.history(run.chatId, run.id)
      .filter((message) => message.metadata.browserScreenshot).map((message) => message.id));
    const global = this.store.global();
    const guard = new AbortController();
    const abortSignal = AbortSignal.any([signal, guard.signal]);
    const env = { ...process.env, BASEDCODE_AUTH: undefined, BASEDCODE_API: undefined };
    const entry = this.active.get(run.id);
    let model: LanguageModel;
    let allowed: (toolName: string, input: unknown) => boolean;
    let cleanup = async () => undefined as void;
    let violation: string | undefined;
    const onNative = (kind: string) => {
      violation ??= kind;
      guard.abort(new Error('Native tool use.'));
    };
    const violationError = () =>
      new Error(
        `${provider.kind === 'codex' ? 'Codex' : 'Claude Code'} attempted a native operation (${violation}) outside BasedCode tools. The run was stopped; no native result was accepted.`,
      );
    if (provider.kind === 'claude') {
      // A custom MCP server rather than the AI SDK bridge, which turns every result into text and would drop images.
      const server = createCustomMcpServer({
        name: 'basedcode',
        tools: Object.fromEntries(
          definitions.map((definition) => [
            definition.name,
            {
              description: definition.description,
              inputSchema: inputSchema(definition.shape),
              handler: async (args: Record<string, unknown>) => {
                try {
                  const result = await definition.execute(args);
                  if (isImageResult(result))
                    return {
                      content: [
                        { type: 'text' as const, text: imageCaption(result) },
                        ...resultImages(result).map((image) => ({
                          type: 'image' as const,
                          data: image.data,
                          mimeType: image.mediaType,
                        })),
                      ],
                    };
                  return {
                    content: [
                      {
                        type: 'text' as const,
                        text:
                          typeof result === 'string'
                            ? result
                            : (JSON.stringify(result) ?? 'undefined'),
                      },
                    ],
                  };
                } catch (error) {
                  return {
                    isError: true,
                    content: [
                      {
                        type: 'text' as const,
                        text: error instanceof Error ? error.message : String(error),
                      },
                    ],
                  };
                }
              },
            },
          ]),
        ),
      });
      model = createClaudeCode().languageModel(provider.model || 'default', {
        cwd: workspace.path,
        systemPrompt: instructions,
        pathToClaudeCodeExecutable: cliPath('claude', global.claudePath),
        tools: [],
        settingSources: [],
        plugins: [],
        hooks: {},
        persistSession: false,
        strictMcpConfig: true,
        includePartialMessages: true,
        mcpServers: { basedcode: server },
        allowedTools: definitions.map((definition) => `mcp__basedcode__${definition.name}`),
        canUseTool: async (name, input) =>
          name.startsWith('mcp__basedcode__')
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Only BasedCode operational tools are permitted.' },
        ...(provider.effort === reasoningOff
          ? { thinking: { type: 'disabled' as const } }
          : { effort: (provider.effort || undefined) as EffortLevel | undefined }),
        // Streaming input keeps the session open for steering messages.
        streamingInput: 'always',
        onStreamStart: (injector) => {
          if (entry) entry.injector = injector;
        },
        env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: 'basedcode/0.1.0' },
        logger: false,
      });
      allowed = (name) => name.startsWith('mcp__basedcode__');
    } else {
      // The Codex bridge only carries text, so images arrive as a note instead of pixels.
      const server = await createLocalMcpServer({
        name: 'basedcode',
        tools: definitions.map((definition) =>
          codexTool({
            name: definition.name,
            description: definition.description,
            parameters: inputSchema(definition.shape),
            execute: async (args: Record<string, unknown>) => {
              const result = await definition.execute(args);
              return isImageResult(result)
                ? {
                    path: result.path,
                    mediaType: result.mediaType,
                    bytes: result.bytes,
                    ...(result.text ? { text: result.text } : {}),
                    note: 'Image pixels cannot pass through this tool bridge. Browser screenshots are attached to chat and will be delivered in the next model turn; finish this turn to inspect them.',
                  }
                : result;
            },
          }),
        ),
      });
      const codexEnv = await this.codexEnvironment({ ...env, BASEDCODE_BRIDGE_TOKEN: undefined });
      if (!codexEnv.isolated)
        this.store.message(
          run.chatId,
          run.id,
          'system',
          'Codex is using your own ~/.codex configuration (no auth.json to copy into an isolated home). User-level config, AGENTS.md and plugins may apply to this run.',
        );
      const codex = createCodexAppServer();
      cleanup = async () => {
        try {
          await codex.close();
        } finally {
          try {
            await server.stop();
          } finally {
            await codexEnv.finish();
          }
        }
      };
      // Hand the bearer token over by environment variable so it does not appear in the CLI's command line.
      const { bearerToken, httpHeaders, ...config } = server.config;
      const token = bearerToken ?? httpHeaders?.Authorization?.replace(/^Bearer /, '');
      model = codex.languageModel(provider.model, {
        cwd: workspace.path,
        codexPath: cliPath('codex', global.codexPath),
        approvalPolicy: 'never',
        sandboxPolicy: 'read-only',
        logger: false,
        effort: (provider.effort === reasoningOff ? 'none' : provider.effort || undefined) as
          | ReasoningEffort
          | undefined,
        summary: 'auto',
        env: { ...codexEnv.env, ...(token ? { BASEDCODE_BRIDGE_TOKEN: token } : {}) },
        serverRequests: {
          onCommandExecutionApproval: nativeApproval('exec', onNative),
          onFileChangeApproval: nativeApproval('patch', onNative),
          onSkillApproval: nativeApproval('skill', onNative),
        },
        // Tool calls can wait on user approval cards, so allow them as long as a person might take.
        mcpServers: {
          basedcode: {
            ...config,
            bearerTokenEnvVar: 'BASEDCODE_BRIDGE_TOKEN',
            startupTimeoutSec: 20,
            toolTimeoutSec: 3600,
          },
        },
        configOverrides: {
          web_search: 'disabled',
          include_apply_patch_tool: false,
          // BasedCode gates these tools itself; headless Codex cannot answer its own approval prompts.
          'mcp_servers.basedcode.default_tools_approval_mode': 'approve',
          ...Object.fromEntries(
            codexDisabledFeatures.map((feature) => [`features.${feature}`, false]),
          ),
        },
      });
      allowed = (name) =>
        definitions.some((definition) => name === `mcp__basedcode__${definition.name}`);
    }

    const { stats, save, due } = this.recorder(run, provider);
    // The CLI runs its whole agent loop in one stream, so each stretch of text between tool calls gets its own message,
    // created when its first text arrives, to keep text and tool messages in the order they happened.
    let stream: ReturnType<Agent['streamMessage']> | undefined;
    let streamed = false;
    const append = (text: string, reasoning = false) => {
      stream ??= this.streamMessage(run);
      stream.append(text, reasoning);
      streamed = true;
    };
    const finish = () => {
      if (stream)
        this.store.put('message', {
          ...stream.message,
          metadata: { ...stream.message.metadata, streaming: false },
        });
      stream = undefined;
    };
    const requested = performance.now();
    let firstToken: number | undefined;
    let lastToken = requested;
    let chunks = 0;
    try {
      const result = streamText({
        model,
        messages: this.transcript(run.chatId, run.id),
        abortSignal,
        maxRetries: 0,
        // Claude takes the instructions as its system prompt setting; Codex exec folds a system message into its prompt.
        ...(provider.kind === 'codex' ? { instructions } : {}),
      });
      for await (const part of result.stream) {
        if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
          firstToken ??= performance.now();
          lastToken = performance.now();
          chunks++;
          if (due())
            save({
              outputTokens: stats.outputTokens + chunks,
              generationMs: lastToken - firstToken,
              estimated: true,
            });
        }
        if (part.type === 'text-delta') append(part.text);
        if (part.type === 'reasoning-delta') append(part.text, true);
        if (part.type === 'tool-call') {
          finish();
          stats.toolCalls++;
          if (!allowed(part.toolName, part.input)) {
            violation = part.toolName;
            guard.abort(new Error('Native tool use.'));
            break;
          }
        }
        // A native item can surface only as a result (no call event first); treat that as a violation too.
        if (
          (part.type === 'tool-result' || part.type === 'tool-error') &&
          !allowed(part.toolName, part.input)
        ) {
          violation = part.toolName;
          guard.abort(new Error('Native tool use.'));
          break;
        }
        if (part.type === 'error') throw part.error;
      }
      if (violation) throw violationError();
      signal.throwIfAborted();
      const usage = await result.usage;
      const metadata = await result.providerMetadata;
      const cost = (metadata?.['claude-code'] as { costUsd?: unknown } | undefined)?.costUsd;
      stats.steps++;
      stats.ttftMs = firstToken === undefined ? undefined : Math.round(firstToken - requested);
      stats.promptMs = stats.ttftMs ?? 0;
      stats.generationMs = Math.round(firstToken === undefined ? 0 : lastToken - firstToken);
      stats.inputTokens = usage.inputTokens ?? 0;
      stats.reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;
      stats.estimated = usage.outputTokens === undefined;
      stats.outputTokens = usage.outputTokens ?? chunks;
      if (typeof cost === 'number') stats.costUsd = cost;
      else {
        const estimate = estimateCost(provider.kind, provider.model, {
          inputTokens: stats.inputTokens,
          cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
          outputTokens: stats.outputTokens,
        });
        if (estimate !== undefined) {
          stats.costUsd = estimate;
          stats.costEstimated = true;
        }
      }
      save();
      // Fallback for providers that report text only at the end rather than streaming it.
      if (!streamed) {
        const text = await result.text;
        if (text) append(text);
        const reasoning = await result.reasoningText;
        if (reasoning) append(reasoning, true);
      }
    } catch (error) {
      // The guard's abort surfaces as an abort error; report the native operation that caused it instead.
      if (violation) throw violationError();
      if (error instanceof Error && usageLimitText.test(error.message))
        throw new QuotaError(`${provider.kind}: ${error.message}`);
      throw error;
    } finally {
      entry?.injector?.close();
      if (entry) entry.injector = undefined;
      finish();
      await cleanup();
      // Codex reports its windows on demand without using quota, so refresh them after every Codex run.
      if (provider.kind === 'codex')
        void this.limits.refreshCodex(global.codexPath).catch(() => undefined);
    }
    // Codex's tool bridge is text-only; chat attachments use its supported image-input path.
    if (provider.kind === 'codex' && this.history(run.chatId, run.id).some(
      (message) => message.metadata.browserScreenshot && !screenshotsBefore.has(message.id),
    )) {
      signal.throwIfAborted();
      await this.subscription(provider, workspace, run, signal, definitions, instructions);
    }
  }

  /**
   * Stops running prompts that have written nothing for `stallTimeoutMs` while no tool call was in progress
   * (a hung model process). Approval waits, paused runs and reconnect backoff are not stalls.
   */
  private checkStalled(now = Date.now()): void {
    for (const [id, entry] of this.active) {
      if (entry.stalled) continue;
      const run = this.store.get('run', id);
      if (run.status !== 'running' || run.reconnecting || this.compacting.has(run.chatId)) continue;
      const last = this.store.runActivity.get(id) ?? now;
      if (now - last < stallTimeoutMs) continue;
      const toolRunning = this.store
        .all('message')
        .some(
          (message) =>
            message.runId === id &&
            (message.metadata.tool as { status?: string } | undefined)?.status === 'running',
        );
      if (toolRunning) continue;
      entry.stalled = true;
      entry.controller.abort(
        new Error(
          `No response from the model for ${Math.round(stallTimeoutMs / 60_000)} minutes, so the prompt was stopped.`,
        ),
      );
      void this.processes.stopRuns(new Set([id]));
    }
  }

  async stop(id: string): Promise<void> {
    const active = this.active.get(id);
    if (active) {
      active.controller.abort(new Error('Stopped by user.'));
      await this.processes.stopRuns(new Set([id]));
      await active.completion;
      return;
    }
    const run = this.store.get('run', id);
    if (run.status === 'queued') this.update(run, { status: 'cancelled' });
  }

  async stopWorkspace(workspace: Workspace): Promise<void> {
    const targets = [...this.active].filter(([, value]) =>
      overlap(value.workspace.path, workspace.path),
    );
    await Promise.all(targets.map(([id]) => this.stop(id)));
    for (const run of this.store.all('run').filter((run) => run.status === 'queued')) {
      if (overlap(this.store.get('workspace', run.workspaceId).path, workspace.path))
        this.update(run, { status: 'cancelled' });
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
  }

  syncTerminalControl(runId?: string): void {
    if (!runId || !this.active.has(runId)) return;
    const run = this.store.get('run', runId);
    if (run.status === 'running' || run.status === 'paused')
      this.update(run, { status: this.processes.hasTakeover(runId) ? 'paused' : 'running' });
  }

  suspendScheduling(): void {
    this.suspended = true;
  }
  resumeScheduling(): void {
    this.suspended = false;
    void this.pump();
  }
}

/** The system prompt part for a guided chat mode, if the chat has one. */
function guidedModePart(mode: string | undefined): { label: string; text: string }[] {
  const info = guidedMode(mode);
  return info ? [{ label: info.label, text: `\n\n${info.prompt}` }] : [];
}
