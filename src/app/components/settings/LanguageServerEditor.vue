<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LanguageConfig } from '../../../shared/types';
import { Trash2 } from '../../icons';
import { t } from '../../theme/themes';
import FormDialog from '../common/FormDialog.vue';
import { languageServerGuides as guides, languageServerExecutable as baseName } from './languageServerGuides';

const servers = defineModel<LanguageConfig[]>({ required: true });
const props = defineProps<{
  persist: () => Promise<string>;
  refresh: () => Promise<void>;
  remove: (config: LanguageConfig) => Promise<boolean>;
}>();

// Add/edit dialog over a text form: languages comma-separated, one argument per line.
interface Draft {
  originalId?: string;
  name: string;
  languages: string;
  command: string;
  args: string;
}
const draft = ref<Draft>();
const saving = ref(false);
const dialogError = ref('');
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
const parsedDraft = computed<LanguageConfig | undefined>(() => {
  const value = draft.value;
  if (!value) return undefined;
  const languages = value.languages.split(/[\s,]+/).filter(Boolean);
  if (!value.name.trim() || !value.command.trim() || !languages.length) return undefined;
  let id = value.originalId ?? slug(value.name);
  for (let n = 2; !value.originalId && servers.value.some((server) => server.id === id); n++) id = `${slug(value.name)}-${n}`;
  return {
    id,
    name: value.name.trim(),
    languages,
    command: value.command.trim(),
    args: value.args.split(/\r?\n/).map((arg) => arg.trim()).filter(Boolean),
  };
});
const presets = computed(() =>
  guides.filter((guide) => !servers.value.some((server) => baseName(server.command) === guide.command)),
);
function openAdd() {
  dialogError.value = '';
  draft.value = { name: '', languages: '', command: '', args: '--stdio' };
}
function usePreset(guide: (typeof guides)[number]) {
  draft.value = { name: guide.name, languages: guide.languages.join(', '), command: guide.command, args: guide.args.join('\n') };
}
function openEdit(config: LanguageConfig) {
  dialogError.value = '';
  draft.value = {
    originalId: config.id,
    name: config.name,
    languages: config.languages.join(', '),
    command: config.command,
    args: config.args.join('\n'),
  };
}
async function closeDialog() {
  if (!saving.value) draft.value = undefined;
}
async function apply() {
  const config = parsedDraft.value;
  if (!config || saving.value) return;
  saving.value = true;
  dialogError.value = '';
  const previous = servers.value.slice();
  servers.value = draft.value?.originalId
    ? servers.value.map((server) => (server.id === config.id ? config : server))
    : [...servers.value, config];
  try {
    const message = await props.persist();
    if (message) {
      servers.value = previous;
      dialogError.value = message;
      return;
    }
    draft.value = undefined;
    await props.refresh();
  } finally {
    saving.value = false;
  }
}
async function removeDraft() {
  const config = servers.value.find((server) => server.id === draft.value?.originalId);
  if (config && (await props.remove(config))) draft.value = undefined;
}
defineExpose({ openAdd, openEdit });
</script>

<template>
  <FormDialog
    v-if="draft"
    :title="draft.originalId ? t('Edit {name}', { name: draft.name || t('server') }) : t('Add language server')"
    @close="closeDialog"
    @submit="apply"
  >
    <div
      v-if="!draft.originalId && presets.length"
      class="lsp-presets"
    >
      <span class="muted small">{{ t('Start from a preset') }}</span>
      <button
        v-for="guide in presets"
        :key="guide.command"
        type="button"
        class="secondary-button"
        @click="usePreset(guide)"
      >
        {{ guide.name }}
      </button>
    </div>
    <label>{{ t('Name') }}
      <input
        v-model="draft.name"
        maxlength="80"
        autocomplete="off"
        required
        autofocus
      >
    </label>
    <label>{{ t('Language IDs') }}
      <input
        v-model="draft.languages"
        autocomplete="off"
        spellcheck="false"
        placeholder="typescript, javascript"
        required
      >
      <small class="muted">{{ t('Comma-separated LSP language IDs this server handles.') }}</small>
    </label>
    <label>{{ t('Command') }}
      <input
        v-model="draft.command"
        autocomplete="off"
        spellcheck="false"
        placeholder="typescript-language-server"
        required
      >
      <small class="muted">{{ t('An executable on PATH, or its full path for a custom install.') }}</small>
    </label>
    <label>{{ t('Arguments') }}
      <textarea
        v-model="draft.args"
        class="code-input"
        rows="3"
        spellcheck="false"
        placeholder="--stdio"
      />
      <small class="muted">{{ t('One argument per line.') }}</small>
    </label>
    <p
      v-if="dialogError"
      class="error-box"
      role="alert"
    >
      {{ dialogError }}
    </p>
    <template #footer>
      <button
        v-if="draft.originalId"
        type="button"
        class="secondary-button danger-action"
        :disabled="saving"
        @click="removeDraft"
      >
        <Trash2 :size="14" /> {{ t('Remove') }}
      </button>
      <button
        type="button"
        class="secondary-button"
        :disabled="saving"
        @click="closeDialog"
      >
        {{ t('Cancel') }}
      </button>
      <button
        type="submit"
        class="primary-button"
        :disabled="saving || !parsedDraft"
      >
        {{ saving ? t('Saving…') : draft.originalId ? t('Save changes') : t('Add server') }}
      </button>
    </template>
  </FormDialog>
</template>

<style scoped>
.lsp-presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
</style>
