import type { FinishReason } from 'ai';

const recoveryLimit = 3;

/** Decide completion from the whole step, including providers that label tool calls as "stop". */
export function localStep(
  finishReason: FinishReason,
  text: string,
  toolCalls: number,
  recoveries: number,
): string | undefined {
  if (['error', 'content-filter', 'other'].includes(finishReason)) {
    throw new Error(
      `Local model generation ended unexpectedly (${finishReason}); the task was not completed.`,
    );
  }
  // Executed tools must receive a follow-up even when the provider reports "stop".
  if (toolCalls) return '';
  if (finishReason === 'stop' && text.trim()) return undefined;
  if (recoveries >= recoveryLimit) {
    throw new Error(
      `Local model failed to produce a complete answer after ${recoveryLimit} continuation attempts (finish reason: ${finishReason}).`,
    );
  }
  return finishReason === 'length'
    ? 'Your reply hit the length limit. Continue exactly where it stopped; do not repeat finished work.'
    : 'That reply had neither a final answer nor a tool call. Call a tool to continue, or give the final answer if the task is done.';
}
