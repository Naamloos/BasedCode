<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue';
import { ArrowUp, File, Folder, X } from '../../icons';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';

const props = defineProps<{ mode: 'folder' | 'files'; initialPath?: string }>();
const emit = defineEmits<{ close: []; pick: [paths: string[]] }>();
const modal = ref<HTMLElement>();
const path = ref(props.initialPath ?? '');
const current = ref('');
const parent = ref('');
const entries = ref<{ name: string; path: string; directory: boolean }[]>([]);
const selected = ref<string[]>([]);
const busy = ref(false);
const error = ref('');
const truncated = ref(false);
const previous = document.activeElement as HTMLElement | null;
async function browse(target?: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await rpc<{
      path: string;
      parent: string;
      truncated: boolean;
      entries: typeof entries.value;
    }>('filesystem.browse', {
      ...(target ? { path: target } : {}),
      directoriesOnly: props.mode === 'folder',
    });
    path.value = result.path;
    current.value = result.path;
    parent.value = result.parent;
    entries.value = result.entries;
    truncated.value = result.truncated;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
function select(file: string) {
  selected.value = selected.value.includes(file)
    ? selected.value.filter((path) => path !== file)
    : [...selected.value, file];
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
  }
  if (event.key !== 'Tab') return;
  const elements = [
    ...modal.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
  ];
  if (event.shiftKey && document.activeElement === elements[0]) {
    event.preventDefault();
    elements.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
    event.preventDefault();
    elements[0]?.focus();
  }
}
onMounted(async () => {
  await nextTick();
  modal.value?.querySelector('input')?.focus();
  void browse(props.initialPath);
});
onBeforeUnmount(() => previous?.focus());
</script>

<template>
  <Teleport to="body">
    <div
      class="modal-backdrop file-picker-backdrop"
      @click.self="emit('close')"
      @keydown="keydown"
    >
      <section
        ref="modal"
        class="small-modal file-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-picker-title"
      >
        <header class="modal-header">
          <h2 id="file-picker-title">
            {{ t(mode === 'folder' ? 'Choose a folder' : 'Attach files') }}
          </h2>
          <button
            type="button"
            class="icon-button"
            :aria-label="t('Close file picker')"
            @click="emit('close')"
          >
            <X :size="17" />
          </button>
        </header>
        <form
          class="file-picker-path"
          autocomplete="off"
          @submit.prevent="browse(path)"
        >
          <button
            type="button"
            class="icon-button"
            :aria-label="t('Parent folder')"
            :disabled="busy || !parent || current === parent"
            @click="browse(parent)"
          >
            <ArrowUp :size="16" />
          </button>
          <input
            v-model="path"
            :aria-label="t('Folder path')"
            autocomplete="off"
            :placeholder="t('Enter an absolute folder path')"
            :disabled="busy"
          >
          <button
            type="submit"
            class="secondary-button"
            :disabled="busy"
          >
            {{ t('Go') }}
          </button>
        </form>
        <p
          v-if="error"
          class="error-text"
          role="alert"
        >
          {{ error }}
        </p>
        <p
          v-if="busy"
          role="status"
          class="muted"
        >
          {{ t('Loading folder…') }}
        </p>
        <div
          class="file-picker-entries"
          :aria-busy="busy"
        >
          <button
            v-for="entry in entries"
            :key="entry.path"
            type="button"
            :disabled="busy"
            :aria-pressed="!entry.directory ? selected.includes(entry.path) : undefined"
            @click="entry.directory ? browse(entry.path) : select(entry.path)"
          >
            <component
              :is="entry.directory ? Folder : File"
              :size="16"
            /><span>{{
              entry.name
            }}</span><span v-if="selected.includes(entry.path)">✓</span>
          </button>
          <p
            v-if="!busy && !entries.length"
            class="muted"
          >
            {{ t(mode === 'folder' ? 'No folders here.' : 'No files here.') }}
          </p>
        </div>
        <p
          v-if="truncated"
          class="muted"
        >
          {{ t('Showing the first 1,000 entries. Enter a more specific folder path to continue.') }}
        </p>
        <footer class="modal-footer">
          <span class="muted small">{{
            mode === 'files' ? t('{count} selected', { count: selected.length }) : current
          }}</span><span class="spacer" />
          <button
            type="button"
            class="secondary-button"
            @click="emit('close')"
          >
            {{ t('Cancel') }}
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="busy || (mode === 'folder' ? !current : !selected.length)"
            @click="emit('pick', mode === 'folder' ? [current] : selected)"
          >
            {{ t(mode === 'folder' ? 'Choose folder' : 'Attach') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
