<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Brain, Pencil, Plus, RefreshCw, Trash2 } from '../../icons';
import type { Memory, Workspace } from '../../../shared/types';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { t } from '../../theme/themes';
import AppSelect from '../common/AppSelect.vue';
import FormDialog from '../common/FormDialog.vue';

const props = defineProps<{ workspace?: Workspace; workspaces: Workspace[] }>();
const enabled = defineModel<boolean>('enabled', { required: true });

// Keep in step with maxMemoryLength in server/agent/memory.ts.
const maxLength = 600;
const memories = ref<Memory[]>([]);
const filter = ref('');
const loading = ref(false);
const busy = ref(false);
const error = ref('');

const workspaceName = (id?: string) =>
  props.workspaces.find((workspace) => workspace.id === id)?.name ?? t('Removed workspace');

const groups = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  const visible = memories.value.filter((memory) => !needle || memory.content.toLowerCase().includes(needle));
  const byWorkspace = new Map<string, Memory[]>();
  for (const memory of visible)
    if (memory.scope === 'workspace')
      byWorkspace.set(memory.workspaceId ?? '', [...(byWorkspace.get(memory.workspaceId ?? '') ?? []), memory]);
  // The open workspace first, then the others by name.
  const workspaceGroups = [...byWorkspace.entries()]
    .map(([id, items]) => ({ key: id, title: workspaceName(id), items, current: id === props.workspace?.id }))
    .sort((a, b) => Number(b.current) - Number(a.current) || a.title.localeCompare(b.title));
  return [
    { key: 'global', title: t('Global · every workspace'), items: visible.filter((memory) => memory.scope === 'global'), current: false },
    ...workspaceGroups,
  ].filter((group) => group.items.length);
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    memories.value = await rpc<Memory[]>('memory.list');
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    loading.value = false;
  }
}
watch(() => props.workspace?.id, load, { immediate: true });

interface Draft {
  id?: string;
  content: string;
  target: string;
}
const editing = ref<Draft>();
const dialogError = ref('');
const targets = computed(() => [
  { value: 'global', label: t('Global · every workspace') },
  ...props.workspaces
    .filter((workspace) => !workspace.scratch && !workspace.removedAt)
    .map((workspace) => ({ value: workspace.id, label: workspace.name })),
]);

function create() {
  dialogError.value = '';
  editing.value = { content: '', target: props.workspace && !props.workspace.scratch ? props.workspace.id : 'global' };
}
function edit(memory: Memory) {
  dialogError.value = '';
  editing.value = { id: memory.id, content: memory.content, target: memory.scope === 'global' ? 'global' : (memory.workspaceId ?? 'global') };
}
async function save() {
  const draft = editing.value;
  if (!draft?.content.trim()) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await rpc('memory.save', {
      ...(draft.id ? { id: draft.id } : {}),
      content: draft.content,
      ...(draft.target === 'global' ? { scope: 'global' } : { scope: 'workspace', workspaceId: draft.target }),
    });
    editing.value = undefined;
    await load();
  } catch (failure) {
    dialogError.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
async function remove(ids: string[], label: string) {
  if (!(await confirmAction(t('Delete memory?'), label, t('Delete')))) return;
  busy.value = true;
  try {
    await rpc('memory.delete', { memoryIds: ids });
    if (editing.value?.id && ids.includes(editing.value.id)) editing.value = undefined;
    await load();
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="memory-panel">
    <h3>{{ t('Memory') }}</h3>
    <p class="muted">
      {{
        t(
          'Short facts the agent keeps between chats, such as your preferences, decisions and their reasons. They are added to every prompt in the workspace they belong to; global memories apply everywhere. The agent saves them with memory_save, and you can add, edit or delete them here.',
        )
      }}
    </p>
    <label class="setting-row">
      <span class="setting-row-text">
        <strong>{{ t('Use memory') }}</strong>
        <small>{{ t('Send memories to the model and let it save new ones. Turning this off keeps the saved memories.') }}</small>
      </span>
      <input
        v-model="enabled"
        class="switch"
        type="checkbox"
      >
    </label>
    <div class="memory-toolbar">
      <input
        v-model="filter"
        type="search"
        autocomplete="off"
        :aria-label="t('Filter memories')"
        :placeholder="t('Filter memories')"
      >
      <span class="spacer" />
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
      <button
        type="button"
        class="primary-button"
        @click="create"
      >
        <Plus :size="14" /> {{ t('New memory') }}
      </button>
    </div>
    <p
      v-if="error"
      class="error-box"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-if="!loading && !memories.length"
      class="memory-empty"
    >
      <Brain :size="22" />
      <p>{{ t('No memories yet. The agent adds them as it learns what matters to you, or you can add one.') }}</p>
    </div>
    <section
      v-for="group in groups"
      :key="group.key"
      class="memory-group"
    >
      <header>
        <strong>{{ group.title }}</strong>
        <span
          v-if="group.current"
          class="memory-badge"
        >{{ t('Open') }}</span>
        <span class="spacer" />
        <span class="muted small">{{ group.items.length }}</span>
        <button
          v-if="group.items.length > 1"
          type="button"
          class="icon-button"
          :title="t('Delete all in this group')"
          :aria-label="t('Delete all in this group')"
          :disabled="busy"
          @click="remove(group.items.map((memory) => memory.id), t('{count} memories in {group}', { count: group.items.length, group: group.title }))"
        >
          <Trash2 :size="14" />
        </button>
      </header>
      <ul>
        <li
          v-for="memory in group.items"
          :key="memory.id"
        >
          <div class="memory-text">
            <p>{{ memory.content }}</p>
            <small class="muted">
              {{ memory.source === 'agent' ? t('Saved by the agent') : t('Added by you') }} ·
              {{ new Date(memory.updatedAt).toLocaleString() }}
            </small>
          </div>
          <button
            type="button"
            class="icon-button"
            :title="t('Edit memory')"
            :aria-label="t('Edit memory')"
            :disabled="busy"
            @click="edit(memory)"
          >
            <Pencil :size="14" />
          </button>
          <button
            type="button"
            class="icon-button"
            :title="t('Delete memory')"
            :aria-label="t('Delete memory')"
            :disabled="busy"
            @click="remove([memory.id], memory.content)"
          >
            <Trash2 :size="14" />
          </button>
        </li>
      </ul>
    </section>
    <p
      v-if="memories.length && !groups.length"
      class="muted"
    >
      {{ t('No memories match this filter.') }}
    </p>

    <FormDialog
      v-if="editing"
      :title="editing.id ? t('Edit memory') : t('New memory')"
      @close="editing = undefined"
      @submit="save"
    >
      <label>{{ t('Applies to') }}
        <AppSelect
          v-model="editing.target"
          :options="targets"
        />
      </label>
      <label>{{ t('Memory') }}
        <textarea
          v-model="editing.content"
          rows="4"
          :maxlength="maxLength"
          autofocus
          :placeholder="t('One fact, such as: Prefers small commits with Conventional Commit messages.')"
        />
      </label>
      <p class="muted small">
        {{ editing.content.length }} / {{ maxLength }}
      </p>
      <p
        v-if="dialogError"
        class="error-box"
        role="alert"
      >
        {{ dialogError }}
      </p>
      <template #footer>
        <button
          type="button"
          class="secondary-button"
          :disabled="busy"
          @click="editing = undefined"
        >
          {{ t('Cancel') }}
        </button>
        <button
          type="submit"
          class="primary-button"
          :disabled="busy || !editing.content.trim()"
        >
          {{ busy ? t('Saving…') : t('Save memory') }}
        </button>
      </template>
    </FormDialog>
  </section>
</template>

<style scoped>
.memory-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
.memory-toolbar input[type='search'] {
  flex: 1 1 180px;
  min-width: 0;
}
.memory-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 28px 16px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  text-align: center;
}
.memory-group {
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  overflow: hidden;
}
.memory-group > header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
}
.memory-group ul {
  list-style: none;
  margin: 0;
  padding: 4px;
}
.memory-group li {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
}
.memory-group li:hover {
  background: var(--surface-hover);
}
.memory-text {
  flex: 1;
  min-width: 0;
}
.memory-text p {
  margin: 0 0 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--fs-sm);
}
.memory-text small {
  font-size: var(--fs-xs);
}
.memory-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--tint-hover);
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
