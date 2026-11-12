<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Upload,
} from '../../icons';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';

interface FileStatus {
  path: string;
  index: string;
  worktree: string;
}
interface Status {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: FileStatus[];
}

const props = defineProps<{
  workspaceId: string;
  /** The open chat: its model writes the message, and its audit trail informs it. */
  chatId?: string;
  busy: boolean;
  /** Changes whenever app state refreshes, so the file list follows the agent's edits. */
  version: number;
}>();
const emit = defineEmits<{ error: [message: string]; notice: [message: string] }>();

const status = ref<Status>();
const loading = ref(false);
const working = ref<'' | 'stage' | 'commit' | 'push'>('');
const title = ref('');
const body = ref('');
const generating = ref(false);
const generated = ref<{ model: string; scope: 'staged' | 'all' }>();
const elapsed = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
const prText = ref('');
const copied = ref('');

const fail = (error: unknown) => emit('error', error instanceof Error ? error.message : String(error));

async function load() {
  loading.value = true;
  try {
    status.value = await rpc<Status>('git.status', { workspaceId: props.workspaceId });
  } catch (error) {
    status.value = undefined;
    fail(error);
  } finally {
    loading.value = false;
  }
}
watch(() => props.workspaceId, load, { immediate: true });
// Quietly follow state changes, but never while an operation is in flight.
let pending: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.version,
  () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (!working.value && !loading.value) void load();
    }, 600);
  },
);
defineExpose({ load });
onBeforeUnmount(() => {
  clearTimeout(pending);
  clearInterval(timer);
});

const isStaged = (file: FileStatus) => file.index !== ' ' && file.index !== '?';
const staged = computed(() => status.value?.files.filter(isStaged) ?? []);
/** Nothing or everything staged: work on all changes. Some staged: only those. */
const scope = computed<'staged' | 'all'>(() =>
  staged.value.length && staged.value.length < (status.value?.files.length ?? 0) ? 'staged' : 'all',
);
const letter = (file: FileStatus) => (file.index === '?' ? 'U' : isStaged(file) ? file.index : file.worktree);

async function stage(paths: string[], unstage: boolean) {
  working.value = 'stage';
  try {
    status.value = await rpc<Status>('git.stage', { workspaceId: props.workspaceId, paths, unstage });
  } catch (error) {
    fail(error);
  } finally {
    working.value = '';
  }
}
function toggleAll() {
  if (!status.value?.files.length) return;
  const all = staged.value.length === status.value.files.length;
  void stage(all ? staged.value.map((file) => file.path) : ['.'], all);
}

async function generate() {
  generating.value = true;
  elapsed.value = 0;
  timer = setInterval(() => elapsed.value++, 1000);
  try {
    const result = await rpc<{ title: string; body: string; model: string; scope: 'staged' | 'all' }>(
      'git.message',
      { workspaceId: props.workspaceId, chatId: props.chatId },
    );
    title.value = result.title;
    body.value = result.body;
    generated.value = { model: result.model, scope: result.scope };
  } catch (error) {
    fail(error);
  } finally {
    clearInterval(timer);
    generating.value = false;
  }
}

async function commit() {
  working.value = 'commit';
  try {
    const message = body.value.trim() ? `${title.value.trim()}\n\n${body.value.trim()}` : title.value.trim();
    const result = await rpc<{ summary: string; status: Status }>('git.commit', {
      workspaceId: props.workspaceId,
      message,
      stageAll: scope.value === 'all',
    });
    status.value = result.status;
    title.value = '';
    body.value = '';
    generated.value = undefined;
    emit('notice', result.summary.split('\n')[0]);
  } catch (error) {
    fail(error);
  } finally {
    working.value = '';
  }
}

async function push() {
  working.value = 'push';
  try {
    const result = await rpc<{ status: Status }>('git.push', { workspaceId: props.workspaceId });
    status.value = result.status;
    emit('notice', t('Pushed {branch}.', { branch: status.value.branch }));
  } catch (error) {
    fail(error);
  } finally {
    working.value = '';
  }
}

async function loadPr() {
  if (!props.chatId) return;
  try {
    prText.value = (await rpc<{ body: string }>('pr.describe', { chatId: props.chatId })).body;
  } catch (error) {
    fail(error);
  }
}
async function copy(which: 'message' | 'pr') {
  const text = which === 'pr' ? prText.value : `${title.value}\n\n${body.value}`.trim();
  try {
    await navigator.clipboard.writeText(text);
    copied.value = which;
    setTimeout(() => (copied.value = ''), 1500);
  } catch {
    emit('error', t('Could not copy to the clipboard.'));
  }
}
</script>

<template>
  <section class="git-panel">
    <header class="git-head">
      <GitBranch :size="13" />
      <strong
        class="git-branch"
        :title="status?.upstream"
      >{{ status?.branch ?? '…' }}</strong>
      <span
        v-if="status?.ahead"
        class="git-count"
        :title="t('Commits not pushed yet')"
      ><ArrowUp :size="11" />{{ status.ahead }}</span>
      <span
        v-if="status?.behind"
        class="git-count"
        :title="t('Commits on the remote you do not have')"
      ><ArrowDown :size="11" />{{ status.behind }}</span>
    </header>

    <div
      v-if="status"
      class="git-files"
    >
      <label
        v-if="status.files.length"
        class="git-row all"
      >
        <input
          type="checkbox"
          :checked="staged.length === status.files.length"
          :indeterminate.prop="staged.length > 0 && staged.length < status.files.length"
          :disabled="busy || Boolean(working)"
          @change="toggleAll"
        >
        <span>{{ t('{count} changed file(s)', { count: status.files.length }) }}</span>
        <span class="muted small">{{ t('{count} staged', { count: staged.length }) }}</span>
      </label>
      <p
        v-else
        class="muted small git-empty"
      >
        {{ t('No changes. Working tree clean.') }}
      </p>
      <label
        v-for="file in status.files"
        :key="file.path"
        class="git-row"
        :title="file.path"
      >
        <input
          type="checkbox"
          :checked="isStaged(file)"
          :disabled="busy || Boolean(working)"
          @change="stage([file.path], isStaged(file))"
        >
        <span class="git-path">{{ file.path }}</span>
        <span
          class="git-letter"
          :class="letter(file)"
        >{{ letter(file) }}</span>
      </label>
    </div>

    <div class="git-message">
      <div class="git-message-head">
        <span>{{ scope === 'staged' ? t('Message for staged changes') : t('Message for all changes') }}</span>
        <button
          class="text-button"
          :disabled="generating || !status?.files.length"
          :title="t('Write the message with this chat\'s model, from the diff and the chat\'s audit trail')"
          @click="generate"
        >
          <LoaderCircle
            v-if="generating"
            :size="12"
            class="spin"
          /><Sparkles
            v-else
            :size="12"
          />
          {{ generating ? t('Writing…') : t('Generate') }}
        </button>
      </div>
      <p
        v-if="generating"
        class="git-progress"
        role="status"
      >
        {{
          t('Reading the {scope} diff and writing a message… {seconds}s', {
            scope: scope === 'staged' ? t('staged') : t('full'),
            seconds: elapsed,
          })
        }}
      </p>
      <p
        v-else-if="generated"
        class="muted small"
      >
        {{ t('Written by {model} from {scope} changes. Edit before committing.', { model: generated.model, scope: generated.scope === 'staged' ? t('staged') : t('all') }) }}
      </p>
      <input
        v-model="title"
        type="text"
        :placeholder="t('Summary (required)')"
        maxlength="200"
      >
      <textarea
        v-model="body"
        rows="6"
        :placeholder="t('Description')"
        spellcheck="false"
      />
      <div class="git-actions">
        <button
          class="primary-button"
          :disabled="busy || !title.trim() || !status?.files.length || Boolean(working)"
          :title="busy ? t('Wait for the agent to finish') : ''"
          @click="commit"
        >
          <LoaderCircle
            v-if="working === 'commit'"
            :size="13"
            class="spin"
          /><GitCommitHorizontal
            v-else
            :size="13"
          />
          {{ scope === 'staged' ? t('Commit staged') : t('Commit all') }}
        </button>
        <button
          class="secondary-button"
          :disabled="Boolean(working)"
          :title="t('Push this branch to its remote')"
          @click="push"
        >
          <LoaderCircle
            v-if="working === 'push'"
            :size="13"
            class="spin"
          /><Upload
            v-else
            :size="13"
          />
          {{ t('Push') }}<template v-if="status?.ahead">
            ({{ status.ahead }})
          </template>
        </button>
        <button
          class="icon-button"
          :disabled="!title.trim()"
          :title="t('Copy message')"
          @click="copy('message')"
        >
          <Check
            v-if="copied === 'message'"
            :size="13"
          /><Copy
            v-else
            :size="13"
          />
        </button>
      </div>
      <p class="muted small">
        {{ t('Commits from here skip git hooks, like the agent\'s commits.') }}
      </p>
    </div>

    <details
      v-if="chatId"
      class="git-pr"
      @toggle="(event) => (event.target as HTMLDetailsElement).open && !prText && loadPr()"
    >
      <summary>{{ t('PR description from this chat') }}</summary>
      <p class="muted small">
        {{ t("Built from the audit trail: what actually changed and ran, not what the model remembers.") }}
      </p>
      <textarea
        v-model="prText"
        rows="12"
        spellcheck="false"
      />
      <div class="git-actions">
        <button
          class="secondary-button"
          @click="loadPr"
        >
          <RefreshCw :size="13" /> {{ t('Rebuild') }}
        </button>
        <button
          class="icon-button"
          :disabled="!prText"
          :title="t('Copy')"
          @click="copy('pr')"
        >
          <Check
            v-if="copied === 'pr'"
            :size="13"
          /><Copy
            v-else
            :size="13"
          />
        </button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.git-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  font-size: 12px;
}
.git-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.git-branch {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-count {
  display: inline-flex;
  align-items: center;
  color: var(--muted);
}
.spacer {
  flex: 1;
}
.git-files {
  display: flex;
  flex-direction: column;
  max-height: 40%;
  min-height: 60px;
  overflow-y: auto;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.git-files .git-row {
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  text-align: left;
  margin: 0;
  font-size: 12px;
  font-weight: 400;
  align-items: center;
  gap: 8px;
  padding: 3px 12px;
  min-width: 0;
  cursor: pointer;
}
.git-files .git-row input {
  flex: none;
  width: auto;
  margin: 0;
}
.git-files .git-row:hover {
  background: var(--surface-hover);
}
.git-files .git-row.all {
  font-weight: 600;
}
.git-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}
.git-letter {
  width: 14px;
  text-align: center;
  font-family: var(--mono, monospace);
  color: var(--muted);
}
.git-letter.M {
  color: var(--accent);
}
.git-letter.A,
.git-letter.U {
  color: var(--success);
}
.git-letter.D {
  color: var(--danger);
}
.git-empty {
  padding: 8px 12px;
  margin: 0;
}
.git-message {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
}
.git-message-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-secondary);
}
.git-message input,
.git-message textarea,
.git-pr textarea {
  width: 100%;
  font-size: 12px;
}
.git-pr textarea {
  font-family: var(--mono, monospace);
}
.git-progress {
  margin: 0;
  color: var(--accent);
}
.git-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.git-actions .primary-button,
.git-actions .secondary-button {
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
}
.git-pr {
  padding: 0 12px 14px;
  display: grid;
  gap: 6px;
}
.git-pr summary {
  cursor: pointer;
  color: var(--text-secondary);
  padding: 6px 0;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 11px;
  margin: 0;
}
</style>
