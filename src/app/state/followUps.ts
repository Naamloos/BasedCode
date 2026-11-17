import type { Message, Run } from '../../shared/types';

/** Follow-up prompts a model proposed with suggest_prompts, shown as chips under its last answer. */
export interface FollowUp {
  label: string;
  prompt: string;
  action: 'send' | 'draft';
}

export interface FollowUpSet {
  /** The suggest_prompts tool message; also the dismissal key. */
  messageId: string;
  runId: string;
  suggestions: FollowUp[];
}

const key = 'basedcode.followUps.dismissed';
const keep = 200;
const busy = new Set<Run['status']>(['queued', 'awaiting_approval', 'running', 'paused']);

export interface FollowUpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function parse(message: Message): FollowUp[] {
  const tool = message.metadata.tool as
    | { name?: string; status?: string; args?: { suggestions?: unknown } }
    | undefined;
  if (tool?.name !== 'suggest_prompts' || tool.status !== 'completed') return [];
  const list = Array.isArray(tool.args?.suggestions) ? tool.args.suggestions : [];
  return list
    .flatMap((item: unknown): FollowUp[] => {
      const { label, prompt, action } = (item ?? {}) as Record<string, unknown>;
      return typeof label === 'string' && label.trim() && typeof prompt === 'string' && prompt.trim() &&
        (action === 'send' || action === 'draft')
        ? [{ label: label.trim(), prompt: prompt.trim(), action }]
        : [];
    })
    .slice(0, 3);
}

export function dismissedFollowUps(storage: FollowUpStorage = localStorage): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function dismissFollowUps(messageId: string, storage: FollowUpStorage = localStorage): string[] {
  const next = [...dismissedFollowUps(storage).filter((item) => item !== messageId), messageId].slice(-keep);
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    /* Quota exceeded: the chips still go away for this session. */
  }
  return next;
}

/**
 * The chat's live suggestions: from the latest suggest_prompts call of its last prompt, once that prompt completed,
 * and only until the user sends anything or picks one. Older prompts never show theirs again.
 */
export function currentFollowUps(
  messages: readonly Message[],
  runs: readonly Run[],
  dismissed: readonly string[],
): FollowUpSet | undefined {
  const last = messages.at(-1);
  if (!last) return undefined;
  const run = runs.find((item) => item.id === last.runId);
  if (run?.status !== 'completed' || runs.some((item) => busy.has(item.status))) return undefined;
  const runMessages = messages.filter((message) => message.runId === run.id);
  // A steered message lands inside the run: anything the user sent after the call dismisses it.
  for (let index = runMessages.length - 1; index >= 0; index--) {
    const message = runMessages[index];
    if (message.role === 'user') return undefined;
    const suggestions = parse(message);
    if (!suggestions.length) continue;
    return dismissed.includes(message.id) ? undefined : { messageId: message.id, runId: run.id, suggestions };
  }
  return undefined;
}
