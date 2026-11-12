<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RefreshCw } from "../../icons";
import type {
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

const props = defineProps<{ limits: ProviderLimits[] }>();
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
    !confirm(
      t(
        "Delete old-format checkpoints? Prompts from before the switch to git checkpoints already cannot be reverted.",
      ),
    )
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
const modelMax = computed(() =>
  Math.max(1, ...(report.value?.byModel ?? []).map(value)),
);
</script>

<template>
  <div class="usage-dashboard">
    <div class="row">
      <h3>{{ t("Usage and cost") }}</h3>
      <span class="spacer" />
      <div
        class="segmented"
        role="radiogroup"
        :aria-label="t('Measure')"
      >
        <button
          type="button"
          role="radio"
          :aria-checked="metric === 'tokens'"
          :class="{ active: metric === 'tokens' }"
          @click="metric = 'tokens'"
        >
          {{ t("Tokens") }}
        </button><button
          type="button"
          role="radio"
          :aria-checked="metric === 'cost'"
          :class="{ active: metric === 'cost' }"
          @click="metric = 'cost'"
        >
          {{ t("Cost") }}
        </button>
      </div>
      <button
        class="icon-button"
        :title="t('Refresh')"
        :disabled="loading"
        @click="load"
      >
        <RefreshCw
          :size="14"
          :class="{ spin: loading }"
        />
      </button>
    </div>
    <div class="row usage-range">
      <div
        class="segmented"
        role="radiogroup"
        :aria-label="t('Time range')"
      >
        <button
          v-for="item in ranges"
          :key="item.key"
          type="button"
          role="radio"
          :aria-checked="range === item.key"
          :class="{ active: range === item.key }"
          @click="pickRange(item.key)"
        >
          {{ t(item.label) }}
        </button>
      </div>
      <template v-if="range === 'custom'">
        <input
          v-model="customFrom"
          type="date"
          :aria-label="t('From')"
          @change="load"
        >
        <span class="muted">�</span>
        <input
          v-model="customTo"
          type="date"
          :aria-label="t('To')"
          @change="load"
        >
      </template>
    </div>
    <p
      v-if="error"
      class="error-text"
    >
      {{ error }}
    </p>
    <template v-else-if="report">
      <h4>{{ t("Subscription windows") }}</h4>
      <div class="limit-cards">
        <section
          v-for="kind in ['codex', 'claude', 'antigravity'] as const"
          :key="kind"
          class="limit-card"
        >
          <header class="row">
            <strong>{{ kindNames[kind] }}</strong><span class="spacer" /><button
              class="text-button"
              :disabled="checking === kind"
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
                :size="12"
                :class="{ spin: checking === kind }"
              />
              {{ t(kind === "claude" ? "Check now" : "Refresh") }}
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
      <div class="usage-tiles">
        <div class="usage-tile">
          <span class="usage-label">{{ t("Prompts") }}</span><strong>{{ report.total.runs.toLocaleString() }}</strong>
        </div>
        <div class="usage-tile">
          <span class="usage-label">{{ t("Input tokens") }}</span><strong>{{ formatTokens(report.total.inputTokens) }}</strong>
        </div>
        <div class="usage-tile">
          <span class="usage-label">{{ t("Output tokens") }}</span><strong>{{ formatTokens(report.total.outputTokens) }}</strong><small
            v-if="report.total.reasoningTokens"
            class="muted"
          >{{
            t("{count} reasoning", {
              count: formatTokens(report.total.reasoningTokens),
            })
          }}</small>
        </div>
        <div class="usage-tile">
          <span class="usage-label">{{ t("Reported cost") }}</span><strong>{{ formatCost(report.total.costUsd) }}</strong><small
            v-if="report.total.unpricedRuns"
            class="muted"
          >{{
            t("{count} prompt(s) without a reported cost", {
              count: report.total.unpricedRuns,
            })
          }}</small>
        </div>
        <div class="usage-tile">
          <span class="usage-label">{{ t("Agent time") }}</span><strong>{{ formatDuration(report.total.totalMs) }}</strong>
        </div>
      </div>
      <p class="muted small">
        {{
          t(
            "Claude Code reports its cost. Codex, OpenAI-compatible and Antigravity models use estimated API list prices from LiteLLM, even on a subscription. Local models are unpriced. Reverted prompts still count.",
          )
        }}
      </p>

      <h4>
        {{ rangeTitle }} �
        {{ t(report.bucket === "month" ? "per month" : "per day") }}
      </h4>
      <div
        v-if="report.byDay.length"
        class="usage-days"
        role="list"
      >
        <div
          v-for="day in report.byDay"
          :key="day.day"
          class="usage-day"
          role="listitem"
          :title="`${day.day}: ${show(value(day))} · ${t('{count} prompt(s)', { count: day.runs })}`"
        >
          <span
            class="usage-bar"
            :style="{ height: `${Math.max(2, (value(day) / dayMax) * 100)}%` }"
          /><span class="usage-day-label">{{
            report.bucket === "month" ? day.day : day.day.slice(5)
          }}</span>
        </div>
      </div>
      <p
        v-else
        class="muted"
      >
        {{ t("No prompts in this range.") }}
      </p>

      <h4>{{ t("By model") }}</h4>
      <table class="usage-table">
        <thead>
          <tr>
            <th>{{ t("Model") }}</th>
            <th>{{ t("Prompts") }}</th>
            <th>{{ t("Input") }}</th>
            <th>{{ t("Output") }}</th>
            <th>{{ t("Cost") }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in report.byModel"
            :key="`${row.provider}/${row.model}`"
          >
            <td>
              <span class="muted">{{ row.provider }} /</span> {{ row.model }}
            </td>
            <td>{{ row.runs }}</td>
            <td>{{ formatTokens(row.inputTokens) }}</td>
            <td>{{ formatTokens(row.outputTokens) }}</td>
            <td>
              {{
                row.unpricedRuns === row.runs ? "—" : formatCost(row.costUsd)
              }}
            </td>
            <td class="usage-meter-cell">
              <span
                class="usage-meter"
                :style="{ width: `${(value(row) / modelMax) * 100}%` }"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <h4>{{ t("By workspace") }}</h4>
      <table class="usage-table">
        <thead>
          <tr>
            <th>{{ t("Workspace") }}</th>
            <th>{{ t("Prompts") }}</th>
            <th>{{ t("Tokens") }}</th>
            <th>{{ t("Cost") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in report.byWorkspace"
            :key="row.workspaceId"
          >
            <td>{{ row.name }}</td>
            <td>{{ row.runs }}</td>
            <td>{{ formatTokens(row.inputTokens + row.outputTokens) }}</td>
            <td>
              {{
                row.unpricedRuns === row.runs ? "—" : formatCost(row.costUsd)
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="storage">
      <h4>{{ t("Storage") }}</h4>
      <table class="usage-table">
        <tbody>
          <tr>
            <td>
              {{
                t("Plain chat folders ({count})", {
                  count: storage.scratchChats,
                })
              }}
            </td>
            <td>{{ formatSize(storage.chatsBytes) }}</td>
          </tr>
          <tr>
            <td>{{ t("Prompt checkpoints (git)") }}</td>
            <td>{{ formatSize(storage.checkpointsBytes) }}</td>
          </tr>
          <tr v-if="storage.legacyCheckpointsBytes">
            <td>{{ t("Old-format checkpoints (no longer used)") }}</td>
            <td>{{ formatSize(storage.legacyCheckpointsBytes) }}</td>
          </tr>
          <tr>
            <td>{{ t("Attachments") }}</td>
            <td>{{ formatSize(storage.attachmentsBytes) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">
        <button
          class="secondary-button"
          :disabled="cleaning"
          @click="cleanStorage"
        >
          {{ t("Remove folders of deleted plain chats") }}
        </button>
        <button
          v-if="storage.legacyCheckpointsBytes"
          class="secondary-button"
          :disabled="cleaning"
          @click="removeLegacy"
        >
          {{ t("Delete old-format checkpoints") }}
        </button>
        {{ cleanupNote }}
      </p>
    </template>
  </div>
</template>
