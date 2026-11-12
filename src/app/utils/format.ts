import type { Run, RunStats } from '../../shared/types';

export function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export function formatCount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}K`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

export const formatTokens = (value: number) => formatCount(Math.round(value));

export function formatCost(usd: number): string {
  if (!usd) return '$0';
  return usd < 0.01
    ? `<$0.01`
    : `$${usd < 100 ? usd.toFixed(2) : Math.round(usd).toLocaleString()}`;
}

/** Totals for one chat's prompts, for the chat header. Cost is summed only from provider-reported values. */
export function chatUsage(runs: Run[]): {
  tokens: number;
  costUsd: number;
  priced: boolean;
  prompts: number;
} {
  let tokens = 0;
  let costUsd = 0;
  let priced = false;
  let prompts = 0;
  for (const run of runs) {
    if (!run.stats) continue;
    prompts++;
    tokens += run.stats.inputTokens + run.stats.outputTokens;
    if (run.stats.costUsd !== undefined) {
      costUsd += run.stats.costUsd;
      priced = true;
    }
  }
  return { tokens, costUsd, priced, prompts };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatContext(tokens?: number): string {
  if (!tokens) return '';
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}K ctx` : `${tokens} ctx`;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Output tokens per second of decoding time, or undefined when nothing was decoded yet. */
export function tokensPerSecond(
  stats: Pick<RunStats, 'outputTokens' | 'generationMs'>,
): number | undefined {
  return stats.generationMs > 0 && stats.outputTokens > 0
    ? stats.outputTokens / (stats.generationMs / 1000)
    : undefined;
}

export function formatSpeed(value?: number): string {
  if (value === undefined) return '–';
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} tok/s`;
}

export const modelKey = (provider: string, model: string) => `${provider}/${model}`;

export interface ModelUsage {
  prompts: number;
  inputTokens: number;
  outputTokens: number;
  generationMs: number;
  promptMs: number;
  /** Mean time to first token over prompts that produced a token. */
  averageTtftMs?: number;
  /** Aggregate decode speed: all output tokens over all decoding time. */
  speed?: number;
  /** Aggregate prompt processing speed: input tokens over time to first token. */
  promptSpeed?: number;
  lastUsed?: string;
  lastSpeed?: number;
}

/** Totals per model across finished and running prompts that recorded stats. */
export function usageByModel(runs: Run[]): Map<string, ModelUsage> {
  const usage = new Map<string, ModelUsage & { ttftTotal: number; ttftCount: number }>();
  for (const run of runs) {
    const stats = run.stats;
    if (!stats) continue;
    const key = modelKey(stats.provider, stats.model);
    const entry = usage.get(key) ?? {
      prompts: 0,
      inputTokens: 0,
      outputTokens: 0,
      generationMs: 0,
      promptMs: 0,
      ttftTotal: 0,
      ttftCount: 0,
    };
    entry.prompts++;
    entry.inputTokens += stats.inputTokens;
    entry.outputTokens += stats.outputTokens;
    entry.generationMs += stats.generationMs;
    entry.promptMs += stats.promptMs;
    if (stats.ttftMs !== undefined) {
      entry.ttftTotal += stats.ttftMs;
      entry.ttftCount++;
    }
    if (!entry.lastUsed || run.createdAt > entry.lastUsed) {
      entry.lastUsed = run.createdAt;
      entry.lastSpeed = tokensPerSecond(stats);
    }
    usage.set(key, entry);
  }
  for (const entry of usage.values()) {
    entry.averageTtftMs = entry.ttftCount ? entry.ttftTotal / entry.ttftCount : undefined;
    entry.speed = tokensPerSecond(entry);
    entry.promptSpeed =
      entry.promptMs > 0 && entry.inputTokens > 0
        ? entry.inputTokens / (entry.promptMs / 1000)
        : undefined;
  }
  return usage;
}
