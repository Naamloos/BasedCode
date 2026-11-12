import type { RunStats, UsageReport, UsageTotals } from "../../shared/types.js";
import type { Store } from "../storage/store.js";

/** Totals runs into usage slices for the dashboard. Costs are provider-reported, or estimated from list prices for OpenAI models. */
export interface UsageRange {
  /** Inclusive ISO timestamp lower bound. */
  from?: string;
  /** Exclusive ISO timestamp upper bound. */
  to?: string;
}

/** Ranges longer than this are charted per month instead of per day. */
const MAX_DAILY_BUCKETS = 92;

export function usageReport(store: Store, range: UsageRange = {}): UsageReport {
  const createTotals = (): UsageTotals => ({
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    unpricedRuns: 0,
    totalMs: 0,
  });
  const addStats = (totals: UsageTotals, stats: RunStats) => {
    totals.runs++;
    totals.inputTokens += stats.inputTokens;
    totals.outputTokens += stats.outputTokens;
    totals.reasoningTokens += stats.reasoningTokens;
    totals.totalMs += stats.totalMs;
    if (stats.costUsd === undefined) totals.unpricedRuns++;
    else totals.costUsd += stats.costUsd;
  };
  const total = createTotals();
  const models = new Map<
    string,
    UsageTotals & { provider: string; model: string }
  >();
  const days = new Map<string, UsageTotals & { day: string }>();
  const workspaces = new Map<
    string,
    UsageTotals & { workspaceId: string; name: string }
  >();
  const names = new Map(
    store.all("workspace").map((workspace) => [workspace.id, workspace.name]),
  );
  // Reverted prompts still spent tokens, so they count.
  const runs = store
    .all("run")
    .filter(
      (run) =>
        run.stats &&
        (!range.from || run.createdAt >= range.from) &&
        (!range.to || run.createdAt < range.to),
    );
  const firstDay =
    range.from ??
    runs.reduce(
      (min, run) => (run.createdAt < min ? run.createdAt : min),
      new Date().toISOString(),
    );
  const spanDays =
    ((range.to ? Date.parse(range.to) : Date.now()) - Date.parse(firstDay)) /
    86_400_000;
  const bucketLength = spanDays > MAX_DAILY_BUCKETS ? 7 : 10;
  for (const run of runs) {
    if (!run.stats) continue;
    addStats(total, run.stats);
    const modelKey = `${run.stats.provider}/${run.stats.model}`;
    if (!models.has(modelKey))
      models.set(modelKey, {
        ...createTotals(),
        provider: run.stats.provider,
        model: run.stats.model,
      });
    addStats(models.get(modelKey)!, run.stats);
    const day = run.createdAt.slice(0, bucketLength);
    if (!days.has(day)) days.set(day, { ...createTotals(), day });
    addStats(days.get(day)!, run.stats);
    if (!workspaces.has(run.workspaceId))
      workspaces.set(run.workspaceId, {
        ...createTotals(),
        workspaceId: run.workspaceId,
        name: names.get(run.workspaceId) ?? "Removed workspace",
      });
    addStats(workspaces.get(run.workspaceId)!, run.stats);
  }
  const byTokens = (a: UsageTotals, b: UsageTotals) =>
    b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens);
  return {
    total,
    byModel: [...models.values()].sort(byTokens),
    byWorkspace: [...workspaces.values()].sort(byTokens),
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    bucket: bucketLength === 7 ? "month" : "day",
  };
}
