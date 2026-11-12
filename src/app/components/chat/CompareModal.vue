<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Check, LoaderCircle, Trophy, X } from '../../icons';
import type { Comparison, RunStats } from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';

interface Side {
  runId: string;
  chatId: string;
  provider: string;
  status: string;
  error?: string;
  stats?: RunStats;
  toolCalls: number;
  files: { path: string; kind: string; added: number; removed: number }[];
  changeError?: string;
  added: number;
  removed: number;
  checks: { name: string; status: string }[];
}
interface Result {
  comparison: Comparison;
  sides: Side[];
  leaderboard: { model: string; kept: number; compared: number }[];
}

const props = defineProps<{ comparisonId: string; version: number }>();
const emit = defineEmits<{ close: []; error: [message: string]; open: [chatId: string] }>();
const data = ref<Result>();
const keeping = ref('');

async function load() {
  try {
    data.value = await rpc<Result>('compare.get', { comparisonId: props.comparisonId });
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error));
  }
}
onMounted(load);
// Reload as the re-run progresses.
watch(() => props.version, load);

const running = (side: Side) => ['queued', 'running', 'paused', 'awaiting_approval'].includes(side.status);
const anyRunning = computed(() => data.value?.sides.some(running) ?? true);

async function keep(side: Side) {
  keeping.value = side.runId;
  try {
    await rpc('compare.keep', { comparisonId: props.comparisonId, runId: side.runId });
    await load();
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error));
  } finally {
    keeping.value = '';
  }
}

const seconds = (ms?: number) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)}s`);
const cost = (stats?: RunStats) =>
  stats?.costUsd === undefined ? '–' : `${stats.costEstimated ? '≈' : ''}$${stats.costUsd.toFixed(3)}`;
const tokens = (stats?: RunStats) =>
  stats ? (stats.inputTokens + stats.outputTokens).toLocaleString() : '–';
const passed = (side: Side) =>
  side.checks.length
    ? `${side.checks.filter((check) => check.status === 'passed').length}/${side.checks.length}`
    : t('none');
</script>

<template>
  <div
    class="modal-backdrop"
    @click.self="emit('close')"
  >
    <section
      class="settings-modal compare-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-title"
    >
      <header class="modal-header">
        <div>
          <h2 id="compare-title">
            {{ t('Compare models') }}
          </h2>
          <p class="compare-sub">
            {{ t('The same prompt from the same starting files. Keep the result you want in the workspace.') }}
          </p>
        </div>
        <span class="spacer" />
        <button
          class="icon-button"
          :aria-label="t('Close')"
          @click="emit('close')"
        >
          <X :size="15" />
        </button>
      </header>
      <div
        v-if="data"
        class="compare-body"
      >
        <div class="compare-grid">
          <article
            v-for="(side, index) in data.sides"
            :key="side.runId"
            class="compare-side"
            :class="{ kept: data.comparison.kept === side.runId }"
          >
            <div class="side-head">
              <span class="side-tag">{{ index === 0 ? t('Original') : t('Re-run') }}</span>
              <strong>{{ side.provider }}</strong>
              <LoaderCircle
                v-if="running(side)"
                :size="13"
                class="spin"
              />
              <span
                v-else-if="side.status !== 'completed'"
                class="error-text"
              >{{ t(side.status) }}</span>
            </div>
            <dl>
              <dt>{{ t('Checks passed') }}</dt><dd>{{ passed(side) }}</dd>
              <dt>{{ t('Files changed') }}</dt><dd>{{ side.files.length }}</dd>
              <dt>{{ t('Lines') }}</dt><dd><span class="success-text">+{{ side.added }}</span> <span class="error-text">−{{ side.removed }}</span></dd>
              <dt>{{ t('Tool calls') }}</dt><dd>{{ side.toolCalls }}</dd>
              <dt>{{ t('Tokens') }}</dt><dd>{{ tokens(side.stats) }}</dd>
              <dt>{{ t('Cost') }}</dt><dd>{{ cost(side.stats) }}</dd>
              <dt>{{ t('Time') }}</dt><dd>{{ seconds(side.stats?.totalMs) }}</dd>
            </dl>
            <details
              v-if="side.files.length"
              class="side-files"
            >
              <summary>{{ t('Files') }}</summary>
              <ul>
                <li
                  v-for="file in side.files"
                  :key="file.path"
                >
                  <span class="mono">{{ file.path }}</span>
                  <span class="muted">+{{ file.added }} −{{ file.removed }}</span>
                </li>
              </ul>
            </details>
            <p
              v-if="side.changeError"
              class="muted small"
            >
              {{ side.changeError }}
            </p>
            <p
              v-if="side.error"
              class="error-text small"
            >
              {{ side.error }}
            </p>
            <div class="side-actions">
              <button
                class="secondary-button"
                @click="emit('open', side.chatId)"
              >
                {{ t('Open chat') }}
              </button>
              <button
                class="primary-button"
                :disabled="anyRunning || Boolean(keeping) || data.comparison.kept === side.runId"
                :title="anyRunning ? t('Wait for both prompts to finish') : ''"
                @click="keep(side)"
              >
                <LoaderCircle
                  v-if="keeping === side.runId"
                  :size="13"
                  class="spin"
                />
                <Check
                  v-else-if="data.comparison.kept === side.runId"
                  :size="13"
                />
                {{ data.comparison.kept === side.runId ? t('Kept') : t('Keep this') }}
              </button>
            </div>
            <p
              v-if="data.comparison.current === side.runId"
              class="muted small"
            >
              {{ t('These files are in the workspace now.') }}
            </p>
          </article>
        </div>
        <section
          v-if="data.leaderboard.length"
          class="leaderboard"
        >
          <h3><Trophy :size="13" /> {{ t('Your benchmark in this workspace') }}</h3>
          <table>
            <thead><tr><th>{{ t('Model') }}</th><th>{{ t('Kept') }}</th><th>{{ t('Compared') }}</th></tr></thead>
            <tbody>
              <tr
                v-for="row in data.leaderboard"
                :key="row.model"
              >
                <td>{{ row.model }}</td><td>{{ row.kept }}</td><td>{{ row.compared }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <div
        v-else
        class="compare-body muted"
      >
        {{ t('Loading…') }}
      </div>
    </section>
  </div>
</template>

<style scoped>
.compare-modal {
  width: 860px;
  max-width: 100%;
}
.compare-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.compare-body {
  padding: 16px 22px 22px;
  overflow: auto;
}
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.compare-side {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.compare-side.kept {
  border-color: var(--success);
}
.side-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.side-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--faint);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 12px;
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.side-files ul {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  font-size: 12px;
  display: grid;
  gap: 2px;
}
.side-files li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.side-files summary {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.mono {
  font-family: var(--mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
}
.side-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: auto;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 12px;
  margin: 0;
}
.leaderboard {
  margin-top: 18px;
}
.leaderboard h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--faint);
  margin: 0 0 6px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  text-align: left;
  padding: 5px 6px;
  border-bottom: 1px solid var(--border);
}
th:not(:first-child),
td:not(:first-child) {
  text-align: right;
}
</style>
