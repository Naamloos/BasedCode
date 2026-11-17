<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Download, FileText, Pencil, Trash2 } from '../../icons';
import type { ArtifactType } from '../../../shared/types';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { t } from '../../theme/themes';

const props = defineProps<{
  workspaceId: string;
  chatId?: string;
  /** Bumps on every app state change, so new or updated artifacts show without a manual refresh. */
  version: number;
}>();
const emit = defineEmits<{
  error: [message: string];
  /** Open the artifact as a tab in the centre view. */
  open: [artifact: { id: string; title: string }];
  deleted: [artifactId: string];
}>();

interface Summary {
  id: string;
  title: string;
  mediaType: ArtifactType;
  version: number;
  versions: number;
  updatedAt: string;
  chatId: string;
}

const artifacts = ref<Summary[]>([]);
const filter = ref('');
const scope = ref<'chat' | 'all'>('chat');
const renaming = ref('');
const renameText = ref('');
const busy = ref(false);

const extensions: Record<ArtifactType, string> = {
  'text/markdown': 'md',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'image/svg+xml': 'svg',
};
const typeLabels: Record<ArtifactType, string> = {
  'text/markdown': 'Markdown',
  'text/html': 'HTML',
  'text/plain': 'Text',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'image/svg+xml': 'SVG',
};

const visible = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return artifacts.value.filter(
    (artifact) =>
      (scope.value === 'all' || artifact.chatId === props.chatId) &&
      (!needle || artifact.title.toLowerCase().includes(needle)),
  );
});
const counts = computed(() => ({
  chat: artifacts.value.filter((artifact) => artifact.chatId === props.chatId).length,
  all: artifacts.value.length,
}));

async function load() {
  const workspaceId = props.workspaceId;
  try {
    const result = await rpc<Summary[]>('artifact.list', { workspaceId });
    if (workspaceId !== props.workspaceId) return;
    artifacts.value = result;
  } catch (failure) {
    emit('error', failure instanceof Error ? failure.message : String(failure));
  }
}
watch(() => props.workspaceId, () => {
  artifacts.value = [];
  void load();
}, { immediate: true });
watch(() => props.version, load);
// A chat with no artifacts of its own shows the workspace's, so the tab is never empty for no reason.
watch(
  () => [props.chatId, counts.value.chat] as const,
  ([, own]) => {
    if (!own && counts.value.all) scope.value = 'all';
  },
);

function startRename(artifact: Summary) {
  renaming.value = artifact.id;
  renameText.value = artifact.title;
}
async function finishRename(save: boolean) {
  const artifactId = renaming.value;
  renaming.value = '';
  const title = renameText.value.trim();
  const current = artifacts.value.find((artifact) => artifact.id === artifactId);
  if (!save || !current || !title || title === current.title) return;
  try {
    await rpc('artifact.rename', { artifactId, title });
    await load();
  } catch (failure) {
    emit('error', failure instanceof Error ? failure.message : String(failure));
  }
}
async function remove(artifact: Summary) {
  const approved = await confirmAction(
    t('Delete artifact?'),
    t('{title} and its {count} version(s) are deleted for every chat in this workspace.', {
      title: artifact.title,
      count: artifact.versions,
    }),
    t('Delete'),
  );
  if (!approved) return;
  busy.value = true;
  try {
    await rpc('artifact.delete', { artifactId: artifact.id });
    emit('deleted', artifact.id);
    await load();
  } catch (failure) {
    emit('error', failure instanceof Error ? failure.message : String(failure));
  } finally {
    busy.value = false;
  }
}
async function download(artifact: Summary) {
  try {
    const { content } = await rpc<{ content: string }>('artifact.get', { artifactId: artifact.id });
    const url = URL.createObjectURL(new Blob([content], { type: artifact.mediaType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${artifact.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'artifact'}.${extensions[artifact.mediaType]}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (failure) {
    emit('error', failure instanceof Error ? failure.message : String(failure));
  }
}

defineExpose({ load });
</script>

<template>
  <section class="artifacts-panel">
    <div class="artifact-list-view">
      <p class="muted small">
        {{ t('Documents the agent wrote with artifact_create: reports, plans, pages and data. They are kept with this workspace, outside its files, with every version.') }}
      </p>
      <div class="artifact-toolbar">
        <input
          v-model="filter"
          type="search"
          autocomplete="off"
          :placeholder="t('Filter artifacts')"
          :aria-label="t('Filter artifacts')"
        >
        <div
          v-if="chatId"
          class="seg-control"
          role="radiogroup"
          :aria-label="t('Show')"
          :style="{ '--seg-count': 2, '--seg-index': scope === 'chat' ? 0 : 1 }"
        >
          <button
            type="button"
            role="radio"
            :aria-checked="scope === 'chat'"
            @click="scope = 'chat'"
          >
            {{ t('This chat') }} <span class="artifact-count">{{ counts.chat }}</span>
          </button>
          <button
            type="button"
            role="radio"
            :aria-checked="scope === 'all'"
            @click="scope = 'all'"
          >
            {{ t('Workspace') }} <span class="artifact-count">{{ counts.all }}</span>
          </button>
        </div>
      </div>
      <div
        v-if="!visible.length"
        class="artifact-empty"
      >
        <FileText :size="20" />
        <p class="muted small">
          {{
            artifacts.length
              ? t('No artifacts match.')
              : t('No artifacts yet. Ask the agent to write a report, plan or page as an artifact.')
          }}
        </p>
      </div>
      <ul class="artifact-list">
        <li
          v-for="artifact in visible"
          :key="artifact.id"
        >
          <input
            v-if="renaming === artifact.id"
            v-model="renameText"
            class="artifact-rename"
            maxlength="120"
            :aria-label="t('Artifact name')"
            @keydown.enter.prevent="finishRename(true)"
            @keydown.esc.prevent="finishRename(false)"
            @blur="finishRename(true)"
          >
          <button
            v-else
            type="button"
            class="artifact-row"
            @click="emit('open', { id: artifact.id, title: artifact.title })"
          >
            <span class="artifact-title">{{ artifact.title }}</span>
            <span class="artifact-meta">
              {{ typeLabels[artifact.mediaType] }} ·
              {{ t('{count} version(s)', { count: artifact.versions }) }} ·
              {{ new Date(artifact.updatedAt).toLocaleString() }}
            </span>
          </button>
          <button
            type="button"
            class="icon-button"
            :title="t('Rename')"
            :aria-label="t('Rename')"
            @click="startRename(artifact)"
          >
            <Pencil :size="13" />
          </button>
          <button
            type="button"
            class="icon-button"
            :title="t('Download')"
            :aria-label="t('Download')"
            @click="download(artifact)"
          >
            <Download :size="13" />
          </button>
          <button
            type="button"
            class="icon-button"
            :title="t('Delete artifact')"
            :aria-label="t('Delete artifact')"
            :disabled="busy"
            @click="remove(artifact)"
          >
            <Trash2 :size="13" />
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.artifacts-panel {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 10px 12px;
  overflow: auto;
  min-height: 0;
}
.artifact-list-view {
  display: grid;
  gap: 8px;
}
.artifact-list-view > p {
  margin: 0;
}
.artifact-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.artifact-toolbar input[type='search'] {
  flex: 1 1 140px;
  min-width: 0;
}
.artifact-count {
  color: var(--faint);
  font-size: var(--fs-xs);
}
.artifact-empty {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 24px 12px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  text-align: center;
}
.artifact-empty p {
  margin: 0;
}
.artifact-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.artifact-list li {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius-sm);
}
.artifact-list li:hover {
  background: var(--surface-hover);
}
.artifact-row {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 1px;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: start;
  cursor: pointer;
}
.artifact-title,
.artifact-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-title {
  font-size: var(--fs-sm);
}
.artifact-meta {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.artifact-rename {
  flex: 1;
  min-width: 0;
  margin: 3px 4px;
}
</style>
