import { randomUUID } from 'node:crypto';
import {
  effectiveCommandRules,
  type Approval,
  type ApprovalMode,
  type CommandRules,
  type Run,
} from '../../shared/types.js';
import { Store } from '../storage/store.js';
import { Events } from '../storage/events.js';

/** What a gated operation is, by its approval title. Decides how each approval mode treats it. */
function category(
  title: string,
): 'command' | 'destructive' | 'install' | 'external' | 'integration' | 'consent' {
  if (['Run terminal command', 'Send terminal input', 'Run verification checks'].includes(title))
    return 'command';
  if (title === 'Delete file' || title === 'Delete directory') return 'destructive';
  if (title === 'Git branch' || title === 'Git stash') return 'command';
  if (title.startsWith('Install ')) return 'install';
  if (title.startsWith('MCP tool:') || title === 'Fetch web page' || (title === 'Browser automation' || title === 'Browser network origin'))
    return 'external';
  // Pauses the user asked for (fallback consent, run budgets, repeated failures) are never decided by a mode.
  if (
    [
      'Provider fallback consent',
      'Run budget reached',
      'Repeated failing tool call',
      'Possible secret in outbound call',
    ].includes(
      title,
    )
  )
    return 'consent';
  return 'integration';
}

function matches(pattern: string, command: string): boolean {
  const source = pattern
    .trim()
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  // A trailing " *" also matches the bare command: `git log *` covers `git log`.
  return new RegExp(
    `^${source.endsWith(' .*') ? `${source.slice(0, -3)}(?: .*)?` : source}$`,
    's',
  ).test(command.trim());
}

/** The simple commands a shell line runs, split on `&&`, `||`, `;`, `|` and newlines. */
export function commandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Applies command rules: the matching deny rule, the matching allow rule, or undefined to fall back to the mode.
 * A deny rule matches any segment of the line. An allow rule must cover every segment, and lines with
 * substitutions or redirections are only allowed by an exact rule, so `npm test` never approves `npm test; rm -rf ~`.
 */
export function commandRule(
  rules: CommandRules | undefined,
  command: string,
): { allowed: boolean; rule: string } | undefined {
  if (!rules) return undefined;
  const segments = commandSegments(command);
  const deny = rules.deny.find(
    (rule) =>
      rule.trim() && (matches(rule, command) || segments.some((segment) => matches(rule, segment))),
  );
  if (deny) return { allowed: false, rule: deny };
  const exact = rules.allow.find((rule) => rule.trim() === command.trim());
  if (exact) return { allowed: true, rule: exact };
  if (/[`<>]|\$\(/.test(command) || !segments.length) return undefined;
  const covering = segments.map((segment) =>
    rules.allow.find((rule) => rule.trim() && matches(rule, segment)),
  );
  if (covering.every(Boolean)) return { allowed: true, rule: [...new Set(covering)].join(', ') };
  return undefined;
}

export const approvalModeNames: Record<ApprovalMode, string> = {
  always: 'Always ask',
  'per-tool': 'Ask once per tool',
  'no-commands': 'Edits only',
  'allow-all': 'Allow everything',
};

export class Permissions {
  private readonly pending = new Map<
    string,
    { resolve: (approved: boolean) => void; decision: Promise<boolean>; workspaceId: string; key?: string }
  >();
  /** Called when an approval starts waiting for a person, for push notifications. */
  onPending?: (approval: Approval) => void;
  /** Per-chat decisions for "ask once per tool". Session memory only. */
  private readonly toolDecisions = new Map<string, Map<string, boolean>>();

  constructor(
    private readonly store: Store,
    private readonly events: Events,
  ) {}

  mode(workspaceId: string): ApprovalMode {
    return (
      this.store.get('workspace', workspaceId).settings.approvalMode ??
      this.store.global().approvalMode
    );
  }

  /** Agent and embedded-app operations use their originating run's chat and approval mode. */
  private automatic(mode: ApprovalMode, title: string, run?: Run): boolean | undefined {
    if (!run) return undefined;
    const kind = category(title);
    // Extra consent for cross-provider fallback is something the user asked for explicitly; never skip it.
    if (kind === 'consent') return undefined;
    if (mode === 'allow-all') return true;
    // Edits only: integrations still ask; anything that executes or reaches out is refused.
    if (mode === 'no-commands')
      return ['command', 'install', 'external', 'destructive'].includes(kind) ? false : undefined;
    if (mode === 'per-tool')
      return this.toolDecisions.get(run.chatId)?.get(title);
    return undefined;
  }

  /** `command` is the terminal command line being approved; workspace command rules apply to it. */
  async ask(
    workspaceId: string,
    title: string,
    detail: string,
    signal?: AbortSignal,
    run?: Run,
    command?: string,
  ): Promise<void> {
    signal?.throwIfAborted();
    const mode = this.mode(workspaceId);
    const ruled =
      command !== undefined && run
        ? commandRule(
            effectiveCommandRules(this.store.global(), this.store.get('workspace', workspaceId)),
            command,
          )
        : undefined;
    if (ruled) {
      this.store.put('approval', {
        id: randomUUID(),
        workspaceId,
        runId: run?.id,
        title,
        detail,
        command,
        status: ruled.allowed ? 'approved' : 'denied',
        auto: mode,
        rule: ruled.rule,
      });
      if (!ruled.allowed)
        throw new Error(
          `Refused by the workspace command rule "${ruled.rule}". Ask the user to change the rule if this command is needed.`,
        );
      return;
    }
    const decided = this.automatic(mode, title, run);
    if (decided !== undefined) {
      // Automatic decisions are still recorded, so the audit trail shows what the mode allowed or refused.
      this.store.put('approval', {
        id: randomUUID(),
        workspaceId,
        runId: run?.id,
        title,
        detail,
        status: decided ? 'approved' : 'denied',
        auto: mode,
      });
      if (!decided)
        throw new Error(
          `Refused by the "${approvalModeNames[mode]}" approval mode for this workspace. Ask the user to change it if this operation is needed.`,
        );
      return;
    }
    const key = run && mode === 'per-tool' ? `${run.chatId}\n${title}` : undefined;
    const waiting = !signal && key && [...this.pending.values()].find((item) => item.key === key);
    if (waiting) {
      const approved = await waiting.decision;
      if (!approved) throw new Error('The user denied this operation.');
      return;
    }
    const approval = this.store.put('approval', {
      id: randomUUID(),
      workspaceId,
      runId: run?.id,
      title,
      detail,
      command,
      status: 'pending',
    });
    let resolveDecision!: (approved: boolean) => void;
    const decision = new Promise<boolean>((resolve) => { resolveDecision = resolve; });
    const abort = () => {
      this.store.put('approval', { ...approval, status: 'denied' });
      this.pending.delete(approval.id);
      resolveDecision(false);
      this.events.publish('state');
    };
    this.pending.set(approval.id, {
      workspaceId,
      key,
      decision,
      resolve: (value) => {
        signal?.removeEventListener('abort', abort);
        resolveDecision(value);
      },
    });
    signal?.addEventListener('abort', abort, { once: true });
    this.events.publish('state');
    this.onPending?.(approval);
    const approved = await decision;
    signal?.throwIfAborted();
    if (!approved) throw new Error('The user denied this operation.');
  }

  /** `remember` adds the approved command as an exact allow rule for the workspace. */
  decide(id: string, approved: boolean, remember = false): void {
    const waiting = this.pending.get(id);
    if (!waiting) throw new Error('This approval is no longer pending.');
    const approval = this.store.get('approval', id);
    if (approved && remember && approval.command) {
      const workspace = this.store.get('workspace', waiting.workspaceId);
      const rules = workspace.settings.commandRules ?? { allow: [], deny: [] };
      if (!rules.allow.includes(approval.command.trim())) {
        this.store.put('workspace', {
          ...workspace,
          settings: {
            ...workspace.settings,
            commandRules: { ...rules, allow: [...rules.allow, approval.command.trim()] },
          },
        });
      }
    }
    this.store.put('approval', { ...approval, status: approved ? 'approved' : 'denied' });
    this.pending.delete(id);
    if (waiting.key) {
      const [chatId, title] = waiting.key.split('\n');
      const tools = this.toolDecisions.get(chatId) ?? new Map<string, boolean>();
      tools.set(title, approved);
      this.toolDecisions.set(chatId, tools);
    }
    waiting.resolve(approved);
    this.events.publish('state');
  }
}
