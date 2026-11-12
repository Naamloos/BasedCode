<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RefreshCw, Trash2 } from "../../icons";
import { confirmAction } from "../../state/dialogs";
import type {
  ProviderConfig,
  ProviderLimits,
  UsageReport,
  UsageTotals,
} from "../../../shared/types";
import { kindNames } from "../../../shared/types";
import LimitWindows from "./LimitWindows.vue";
import { rpc } from "../../services/api";
import {
  formatCost,
  formatDuration,
  formatSize,
  formatTokens,
} from "../../utils/format";
import { t } from "../../theme/themes";

const props = defineProps<{
  limits: ProviderLimits[];
  providers: ProviderConfig[];
}>();
const emit = defineEmits<{ refreshed: [] }>();
const report = ref<UsageReport>();
const error = ref("");
const loading = ref(false);
const checking = ref("");
const metric = ref<"tokens" | "cost">("tokens");
type RangeKey = "day" | "week" | "month" | "year" | "all" | "custom";
const ranges: { key: RangeKey; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];
const range = ref<RangeKey>("month");
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const customFrom = ref(isoDate(new Date(Date.now() - 29 * 86_400_000)));
const customTo = ref(isoDate(new Date()));

/** Local-midnight bounds for the chosen range; `to` is exclusive. Day/week/month/year are rolling windows ending today. */
function rangeBounds(): { from?: string; to?: string } {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const daysBack = (days: number) => {
    const date = new Date(startOfToday);
    date.setDate(date.getDate() - days);
    return date.toISOString();
  };
  switch (range.value) {
    case "day":
      return { from: daysBack(0) };
    case "week":
      return { from: daysBack(6) };
    case "month":
      return { from: daysBack(29) };
    case "year":
      return { from: daysBack(364) };
    case "all":
      return {};
    case "custom": {
      if (!customFrom.value || !customTo.value) return {};
      const [from, to] = [customFrom.value, customTo.value].sort();
      const end = new Date(`${to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      return {
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: end.toISOString(),
      };
    }
  }
}
const rangeTitle = computed(() =>
  t(ranges.find((item) => item.key === range.value)!.label),
);
function pickRange(key: RangeKey) {
  range.value = key;
  void load();
}
const limitsFor = (kind: string) =>
  props.limits.find((item) => item.kind === kind);

interface StorageSummary {
  chatsBytes: number;
  checkpointsBytes: number;
  legacyCheckpointsBytes: number;
  attachmentsBytes: number;
  scratchChats: number;
}
const storage = ref<StorageSummary>();
const cleaning = ref(false);
const cleanupNote = ref("");
async function loadStorage() {
  storage.value = await rpc<StorageSummary>("storage.summary");
}
async function cleanStorage() {
  cleaning.value = true;
  try {
    const result = await rpc<StorageSummary & { removed: number }>(
      "storage.cleanup",
    );
    storage.value = result;
    cleanupNote.value = t("Removed {count} unused chat folder(s).", {
      count: result.removed,
    });
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    cleaning.value = false;
  }
}
async function removeLegacy() {
  if (
    !(await confirmAction(
      t("Delete old-format checkpoints?"),
      t(
        "Prompts from before the switch to git checkpoints already cannot be reverted.",
      ),
      t("Delete"),
    ))
  )
    return;
  cleaning.value = true;
  try {
    storage.value = await rpc<StorageSummary>(
      "storage.removeLegacyCheckpoints",
    );
    cleanupNote.value = t("Old-format checkpoints deleted.");
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    cleaning.value = false;
  }
}
onMounted(() => void loadStorage().catch(() => undefined));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    report.value = await rpc<UsageReport>("usage.summary", rangeBounds());
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    loading.value = false;
  }
}
async function check(kind: "codex" | "claude" | "antigravity") {
  checking.value = kind;
  error.value = "";
  try {
    await rpc("limits.refresh", { kind });
    emit("refreshed");
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    checking.value = "";
  }
}
onMounted(() => {
  void load();
  // Codex windows are free to read, so the dashboard always shows fresh ones.
  void check("codex");
});

const value = (totals: UsageTotals) =>
  metric.value === "cost"
    ? totals.costUsd
    : totals.inputTokens + totals.outputTokens;
const show = (amount: number) =>
  metric.value === "cost" ? formatCost(amount) : formatTokens(amount);
const dayMax = computed(() =>
  Math.max(1, ...(report.value?.byDay ?? []).map(value)),
);
const share = (amount: number) => {
  const total = report.value ? value(report.value.total) : 0;
  return total ? Math.round((amount / total) * 100) : 0;
};
/** Label every n-th bar so the axis stays readable on long ranges. */
const labelEvery = computed(() =>
  Math.max(1, Math.ceil((report.value?.byDay.length ?? 0) / 8)),
);
const dayLabel = (day: string) => {
  if (report.value?.bucket === "month")
    return new Date(`${day}-01T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
    });
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

// The chart header reads out the hovered bar, else the range total, so numbers never hide in tooltips.
const hovered = ref(-1);
const readout = computed(() => {
  const day = report.value?.byDay[hovered.value];
  if (!day || !report.value) return undefined;
  return {
    label: dayLabel(day.day),
    value: show(value(day)),
    runs: day.runs,
  };
});

const breakdown = ref<"models" | "workspaces">("models");
interface BreakdownRow {
  key: string;
  name: string;
  detail?: string;
  totals: UsageTotals;
}
const breakdownRows = computed<BreakdownRow[]>(() => {
  if (!report.value) return [];
  const rows: BreakdownRow[] =
    breakdown.value === "models"
      ? report.value.byModel.map((row) => ({
        key: `${row.provider}/${row.model}`,
        name: row.model,
        detail: row.provider,
        totals: row,
      }))
      : report.value.byWorkspace.map((row) => ({
        key: row.workspaceId,
        name: row.name,
        totals: row,
      }));
  return rows.sort((a, b) => value(b.totals) - value(a.totals));
});
const breakdownMax = computed(() =>
  Math.max(1, ...breakdownRows.value.map((row) => value(row.totals))),
);
const rowCost = (totals: UsageTotals) =>
  totals.unpricedRuns === totals.runs ? t("unpriced") : formatCost(totals.costUsd);

const storageTotal = computed(() =>
  storage.value
    ? storage.value.chatsBytes +
      storage.value.checkpointsBytes +
      storage.value.legacyCheckpointsBytes +
      storage.value.attachmentsBytes
    : 0,
);
const storageParts = computed(() => {
  const current = storage.value;
  if (!current) return [];
  return [
    {
      key: "chats",
      label: t("Plain chat folders ({count})", { count: current.scratchChats }),
      bytes: current.chatsBytes,
    },
    { key: "checkpoints", label: t("Prompt checkpoints (git)"), bytes: current.checkpointsBytes },
    { key: "attachments", label: t("Attachments"), bytes: current.attachmentsBytes },
    {
      key: "legacy",
      label: t("Old-format checkpoints (no longer used)"),
      bytes: current.legacyCheckpointsBytes,
    },
  ].filter((part) => part.key !== "legacy" || part.bytes);
});
// Only kinds with a saved connection; a disconnected provider's old windows are just noise.
const limitKinds = computed(() =>
  (["codex", "claude", "antigravity"] as const).filter((kind) =>
    props.providers.some((provider) => provider.kind === kind),
  ),
);
const rangeIndex = computed(() =>
  ranges.findIndex((item) => item.key === range.value),
);
</script>

<template>
  <div class="usage-dashboard">
    <h3>{{ t("Usage and cost") }}</h3>
    <p class="muted">
      {{
        t(
          "Subscription windows come straight from your accounts. Activity below covers prompts run in BasedCode.",
        )
      }}
    </p>

    <!-- Plan limits: independent of the time range, so they sit above it. -->
    <template v-if="limitKinds.length">
      <h4>{{ t("Subscription windows") }}</h4>
      <div class="ud-limits">
        <section
          v-for="kind in limitKinds"
          :key="kind"
          class="ud-card ud-limit"
        >
          <header>
            <span
              class="model-dot"
              :class="kind"
            />
            <strong>{{ kindNames[kind] }}</strong>
            <button
              type="button"
              class="icon-button"
              :disabled="checking === kind"
              :aria-label="t(kind === 'claude' ? 'Check now' : 'Refresh')"
              :title="
                t(
                  kind === 'codex'
                    ? 'Read the current windows from your Codex account (uses no quota)'
                    : kind === 'antigravity'
                      ? 'Read the current windows from your Antigravity account (uses no quota)'
                      : 'Send one tiny Haiku request so Claude Code reports current windows (uses a very small amount of quota)',
                )
              "
              @click="check(kind)"
            >
              <RefreshCw
                :size="13"
                :class="{ spin: checking === kind }"
              />
            </button>
          </header>
          <LimitWindows
            v-if="limitsFor(kind)?.windows.length"
            :limits="limitsFor(kind)"
          />
          <p
            v-else
            class="muted small"
          >
            {{
              t(
                kind === "claude"
                  ? "Claude Code reports its windows with model responses. They appear after your next Claude prompt, or use Check now."
                  : "Not read yet.",
              )
            }}
          </p>
        </section>
      </div>
    </template>

    <div class="ud-section-head">
      <h4>{{ t("Activity") }}</h4>
      <button
        type="button"
        class="icon-button"
        :title="t('Refresh')"
        :aria-label="t('Refresh')"
        :disabled="loading"
        @click="load"
      >
        <RefreshCw
          :size="14"
          :class="{ spin: loading }"
        />
      </button>
    </div>
    <div class="ud-toolbar">
      <div
        class="seg-control ud-range"
        role="radiogroup"
        :aria-label="t('Time range')"
        :style="{ '--seg-count': ranges.length, '--seg-index': rangeIndex }"
      >
        <button
          v-for="item in ranges"
          :key="item.key"
          type="button"
          role="radio"
          :aria-checked="range === item.key"
          @click="pickRange(item.key)"
        >
          {{ t(item.label) }}
        </button>
      </div>
      <div
        class="seg-control"
        role="radiogroup"
        :aria-label="t('Measure')"
        :style="{ '--seg-count': 2, '--seg-index': metric === 'tokens' ? 0 : 1 }"
      >
        <button
          v-for="option in (['tokens', 'cost'] as const)"
          :key="option"
          type="button"
          role="radio"
          :aria-checked="metric === option"
          @click="metric = option"
        >
          {{ t(option === "tokens" ? "Tokens" : "Cost") }}
        </button>
      </div>
    </div>
    <div
      v-if="range === 'custom'"
      class="ud-custom"
    >
      <label>{{ t("From") }}
        <input
          v-model="customFrom"
          type="date"
          @change="load"
        >
      </label>
      <label>{{ t("To") }}
        <input
          v-model="customTo"
          type="date"
          @change="load"
        >
      </label>
    </div>

    <p
      v-if="error"
      class="error-box"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="!report"
      class="muted"
    >
      {{ t("Loading usage…") }}
    </p>
    <template v-else>
      <dl class="ud-card ud-stats">
        <div :class="{ active: metric === 'cost' }">
          <dt>{{ t("Reported cost") }}</dt>
          <dd>{{ formatCost(report.total.costUsd) }}</dd>
          <small v-if="report.total.unpricedRuns">{{
            t("{count} prompt(s) without a reported cost", {
              count: report.total.unpricedRuns,
            })
          }}</small>
        </div>
        <div :class="{ active: metric === 'tokens' }">
          <dt>{{ t("Tokens") }}</dt>
          <dd>
            {{ formatTokens(report.total.inputTokens + report.total.outputTokens) }}
          </dd>
          <small>{{
            t("{input} in · {output} out", {
              input: formatTokens(report.total.inputTokens),
              output: formatTokens(report.total.outputTokens),
            })
          }}</small>
        </div>
        <div>
          <dt>{{ t("Prompts") }}</dt>
          <dd>{{ report.total.runs.toLocaleString() }}</dd>
          <small v-if="report.total.reasoningTokens">{{
            t("{count} reasoning", {
              count: formatTokens(report.total.reasoningTokens),
            })
          }}</small>
        </div>
        <div>
          <dt>{{ t("Agent time") }}</dt>
          <dd>{{ formatDuration(report.total.totalMs) }}</dd>
          <small v-if="report.total.runs">{{
            t("{value} per prompt", {
              value: formatDuration(report.total.totalMs / report.total.runs),
            })
          }}</small>
        </div>
      </dl>

      <section class="ud-card">
        <header class="ud-card-head">
          <strong>{{ rangeTitle }}</strong>
          <span class="muted small">{{
            t(report.bucket === "month" ? "per month" : "per day")
          }}</span>
          <span
            v-if="readout"
            class="ud-readout"
            role="status"
          >
            {{ readout.label }} · <b>{{ readout.value }}</b> ·
            {{ t("{count} prompt(s)", { count: readout.runs }) }}
          </span>
          <span
            v-else-if="report.byDay.length"
            class="ud-readout muted"
          >{{ t("peak {value}", { value: show(dayMax) }) }}</span>
        </header>
        <div
          v-if="report.byDay.length"
          class="ud-chart"
          role="list"
          @mouseleave="hovered = -1"
        >
          <div
            v-for="(day, index) in report.byDay"
            :key="day.day"
            class="ud-col"
            :class="{ hot: hovered === index }"
            role="listitem"
            :aria-label="`${dayLabel(day.day)}: ${show(value(day))}`"
            @mouseenter="hovered = index"
          >
            <span class="ud-slot"><span
              class="ud-bar"
              :class="{ zero: !value(day) }"
              :style="{ height: `${(value(day) / dayMax) * 100}%` }"
            /></span>
            <span class="ud-axis">{{
              index % labelEvery === 0 ? dayLabel(day.day) : ""
            }}</span>
          </div>
        </div>
        <p
          v-else
          class="ud-empty muted"
        >
          {{ t("No prompts in this range.") }}
        </p>
      </section>

      <section
        v-if="report.byModel.length || report.byWorkspace.length"
        class="ud-card"
      >
        <header class="ud-card-head">
          <strong>{{ t("Breakdown") }}</strong>
          <div
            class="seg-control ud-breakdown-toggle"
            role="radiogroup"
            :aria-label="t('Breakdown')"
            :style="{ '--seg-count': 2, '--seg-index': breakdown === 'models' ? 0 : 1 }"
          >
            <button
              type="button"
              role="radio"
              :aria-checked="breakdown === 'models'"
              @click="breakdown = 'models'"
            >
              {{ t("By model") }}
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="breakdown === 'workspaces'"
              @click="breakdown = 'workspaces'"
            >
              {{ t("By workspace") }}
            </button>
          </div>
        </header>
        <ol
          v-if="breakdownRows.length"
          class="ud-rank"
        >
          <li
            v-for="row in breakdownRows"
            :key="row.key"
          >
            <div class="ud-rank-line">
              <span
                class="ud-rank-name"
                :title="row.detail ? `${row.name} · ${row.detail}` : row.name"
              >{{ row.name }}<small v-if="row.detail">{{ row.detail }}</small></span>
              <span class="ud-rank-value">{{ show(value(row.totals)) }}</span>
              <span class="ud-rank-share">{{ share(value(row.totals)) }}%</span>
            </div>
            <span class="ud-meter"><span
              :style="{ width: `${(value(row.totals) / breakdownMax) * 100}%` }"
            /></span>
            <small class="ud-rank-detail">{{
              t("{count} prompt(s)", { count: row.totals.runs })
            }} · {{
              t("{input} in · {output} out", {
                input: formatTokens(row.totals.inputTokens),
                output: formatTokens(row.totals.outputTokens),
              })
            }} · {{ rowCost(row.totals) }}</small>
          </li>
        </ol>
        <p
          v-else
          class="ud-empty muted"
        >
          {{ t("No prompts in this range.") }}
        </p>
      </section>
      <p class="muted small">
        {{
          t(
            "Claude Code reports its cost. Codex, OpenAI-compatible and Antigravity models use estimated API list prices from LiteLLM, even on a subscription. Local models are unpriced. Reverted prompts still count.",
          )
        }}
      </p>
    </template>

    <template v-if="storage">
      <div class="ud-section-head">
        <h4>{{ t("Storage") }}</h4>
        <span class="ud-storage-total">{{ formatSize(storageTotal) }}</span>
      </div>
      <section class="ud-card ud-storage">
        <div
          class="ud-stack"
          aria-hidden="true"
        >
          <span
            v-for="part in storageParts"
            :key="part.key"
            :class="part.key"
            :style="{ flexGrow: part.bytes }"
          />
        </div>
        <ul class="ud-legend">
          <li
            v-for="part in storageParts"
            :key="part.key"
          >
            <span
              class="ud-swatch"
              :class="part.key"
            />
            <span class="ud-legend-label">{{ part.label }}</span>
            <span class="ud-legend-value">{{ formatSize(part.bytes) }}</span>
          </li>
        </ul>
        <footer>
          <button
            type="button"
            class="secondary-button"
            :disabled="cleaning"
            @click="cleanStorage"
          >
            <Trash2 :size="13" /> {{ t("Remove folders of deleted plain chats") }}
          </button>
          <button
            v-if="storage.legacyCheckpointsBytes"
            type="button"
            class="secondary-button"
            :disabled="cleaning"
            @click="removeLegacy"
          >
            <Trash2 :size="13" /> {{ t("Delete old-format checkpoints") }}
          </button>
          <span
            v-if="cleanupNote"
            class="muted small"
            role="status"
          >{{ cleanupNote }}</span>
        </footer>
      </section>
    </template>
  </div>
</template>

<style scoped>
.ud-card {
  min-width: 0;
  margin: 0 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
}
.ud-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-height: 28px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
}
.ud-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 8px;
}
.ud-section-head h4 {
  margin: 0;
  flex: 1;
}

/* Plan limits */
.ud-limits {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.ud-limit {
  margin: 0;
  padding: 10px 12px;
}
.ud-limit > header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: var(--fs-sm);
}
.ud-limit > header strong {
  flex: 1;
  min-width: 0;
}
.ud-limit > p {
  margin: 0;
  line-height: 1.5;
}

/* Range + measure */
.ud-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.ud-toolbar .seg-control > button {
  font-size: var(--fs-xs);
}
.ud-range {
  flex: 1 1 360px;
  max-width: 480px;
}
.ud-custom {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: -4px 0 12px;
}
.ud-custom label {
  flex: 0 1 180px;
}

/* Totals */
.ud-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  padding: 0;
  overflow: hidden;
}
.ud-stats > div {
  display: grid;
  align-content: start;
  gap: 3px;
  min-width: 0;
  padding: 12px 14px;
  box-shadow: -1px 0 0 var(--border);
}
.ud-stats > div.active {
  background: var(--accent-soft);
}
.ud-stats dt {
  font-size: var(--fs-xs);
  color: var(--muted);
}
.ud-stats dd {
  margin: 0;
  font-family: var(--font-code);
  font-size: 20px;
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ud-stats > div.active dd {
  color: var(--accent);
}
.ud-stats small {
  font-size: var(--fs-xs);
  color: var(--muted);
  line-height: 1.4;
}

/* Chart */
.ud-readout {
  margin-inline-start: auto;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ud-readout b {
  color: var(--text);
}
.ud-chart {
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 170px;
  padding: 14px 14px 8px;
  background-image: linear-gradient(to top, var(--border) 1px, transparent 1px);
  background-size: 100% 25%;
  background-origin: content-box;
  background-clip: content-box;
}
.ud-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.ud-slot {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  border-radius: 3px;
}
.ud-col.hot .ud-slot {
  background: var(--tint-hover);
}
.ud-bar {
  width: 70%;
  max-width: 20px;
  min-height: 2px;
  border-radius: 3px 3px 0 0;
  background: var(--accent);
  opacity: 0.75;
}
.ud-bar.zero {
  background: var(--border-strong);
}
.ud-col.hot .ud-bar {
  opacity: 1;
}
.ud-axis {
  height: 14px;
  font-size: 10px;
  color: var(--faint);
  white-space: nowrap;
}
.ud-empty {
  margin: 0;
  padding: 28px 14px;
  text-align: center;
}

/* Breakdown */
.ud-breakdown-toggle {
  margin-inline-start: auto;
}
.ud-breakdown-toggle > button {
  font-size: var(--fs-xs);
}
.ud-rank {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  max-height: 360px;
  overflow: auto;
}
.ud-rank > li {
  display: grid;
  gap: 5px;
  padding: 9px 14px;
}
.ud-rank > li + li {
  border-top: 1px solid var(--border);
}
.ud-rank-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  font-size: var(--fs-sm);
}
.ud-rank-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.ud-rank-name small {
  margin-inline-start: 8px;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.ud-rank-value {
  font-family: var(--font-code);
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.ud-rank-share {
  width: 36px;
  text-align: end;
  font-size: var(--fs-xs);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.ud-meter {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--surface-active);
  overflow: hidden;
}
.ud-meter > span {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: 3px;
  background: var(--accent);
}
.ud-rank-detail {
  font-size: var(--fs-xs);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Storage */
.ud-storage-total {
  font-family: var(--font-code);
  font-size: var(--fs-sm);
  color: var(--text);
}
.ud-storage {
  padding: 12px 14px;
}
.ud-stack {
  display: flex;
  gap: 2px;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--surface-active);
}
.ud-stack > span {
  flex-basis: 0;
  min-width: 2px;
}
.chats {
  background: var(--accent);
}
.checkpoints {
  background: var(--success);
}
.attachments {
  background: #8fb4f0;
}
.legacy {
  background: var(--danger);
}
.ud-legend {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 6px 16px;
  margin: 12px 0 0;
  padding: 0;
  font-size: var(--fs-xs);
}
.ud-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ud-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.ud-legend-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.ud-legend-value {
  font-family: var(--font-code);
  color: var(--text);
}
.ud-storage > footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
</style>