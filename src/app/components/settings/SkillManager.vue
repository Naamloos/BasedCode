<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Workspace } from '../../../shared/types';
import { slashCommands } from '../../../shared/commands';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { t } from '../../theme/themes';

const props = defineProps<{ workspace?: Workspace }>();
type Skill = { name: string; content: string };
const skills = ref<Skill[]>([]);
const selected = ref<Skill>();
const name = ref('');
const content = ref('');
const filter = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const visible = computed(() => skills.value.filter((skill) => skill.name.includes(filter.value.toLowerCase())));
const reserved = computed(() => slashCommands.some((command) => command.name === name.value));
const valid = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name.value) && name.value.length <= 64 && content.value.trim().length > 0 && content.value.length <= 50_000);
const dirty = computed(() => name.value !== (selected.value?.name ?? '') || content.value !== (selected.value?.content ?? ''));
async function discard() {
  return !dirty.value || await confirmAction(t('Discard skill edits?'), t('Your unsaved instructions will be lost.'), t('Discard'));
}
async function select(skill?: Skill) {
  if (!(await discard())) return;
  selected.value = skill;
  name.value = skill?.name ?? '';
  content.value = skill?.content ?? '';
  notice.value = '';
}
async function load() {
  if (!props.workspace) return;
  const workspaceId = props.workspace.id;
  const result = await rpc<Skill[]>('skills.list', { workspaceId });
  if (props.workspace?.id === workspaceId) skills.value = result;
}
watch(() => props.workspace?.id, () => {
  skills.value = []; selected.value = undefined; name.value = ''; content.value = ''; error.value = '';
  void load().catch((failure) => error.value = String(failure));
}, { immediate: true });
async function save() {
  if (!props.workspace || !valid.value || busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    await rpc('skills.save', { workspaceId: props.workspace.id, name: name.value, content: content.value, expectedContent: selected.value?.content });
    selected.value = { name: name.value, content: content.value };
    await load();
    notice.value = t('Skill saved.');
  } catch (failure) { error.value = String(failure); }
  finally { busy.value = false; }
}
async function remove() {
  if (!props.workspace || !selected.value || busy.value) return;
  if (!(await confirmAction(t('Delete skill?'), '/' + selected.value.name, t('Delete')))) return;
  busy.value = true; error.value = '';
  try {
    await rpc('skills.delete', { workspaceId: props.workspace.id, name: selected.value.name, expectedContent: selected.value.content });
    selected.value = undefined; name.value = ''; content.value = '';
    await load();
    notice.value = t('Skill deleted.');
  } catch (failure) { error.value = String(failure); }
  finally { busy.value = false; }
}
</script>

<template>
  <section>
    <h3>{{ t('Skills') }}</h3>
    <p
      v-if="!workspace"
      class="muted"
    >
      {{ t('Open a workspace to manage its skills.') }}
    </p>
    <template v-else>
      <p class="muted">
        {{ t('Workspace skills') }}: {{ workspace.name }}. {{ t('Changes save immediately. Activate a skill with its slash command.') }}
      </p>
      <div class="skill-toolbar">
        <input
          v-model="filter"
          type="search"
          :aria-label="t('Filter skills')"
          :placeholder="t('Filter skills')"
        >
        <button
          class="secondary-button"
          :disabled="busy"
          @click="select()"
        >
          {{ t('New skill') }}
        </button>
        <button
          class="secondary-button"
          :disabled="busy"
          @click="load().catch(failure => error = String(failure))"
        >
          {{ t('Refresh') }}
        </button>
      </div>
      <p
        v-if="!skills.length"
        class="muted"
      >
        {{ t('No skills yet. Create one to add its slash command.') }}
      </p>
      <div class="skill-list">
        <button
          v-for="skill in visible"
          :key="skill.name"
          class="secondary-button"
          :class="{ active: selected?.name === skill.name }"
          :disabled="busy"
          @click="select(skill)"
        >
          /{{ skill.name }}
        </button>
      </div>
      <form @submit.prevent="save">
        <label>{{ t('Skill name') }}
          <input
            v-model="name"
            :disabled="busy || Boolean(selected)"
            autocomplete="off"
            maxlength="64"
            placeholder="review-code"
          >
        </label>
        <p class="muted small">
          {{ t('Use lowercase letters, digits and hyphens.') }}
        </p>
        <p
          v-if="reserved"
          class="muted"
        >
          {{ t('This name is reserved. Activate it with /skill') }} {{ name }}.
        </p>
        <label>{{ t('Instructions (Markdown)') }}
          <textarea
            v-model="content"
            :disabled="busy"
            rows="14"
            maxlength="50000"
            spellcheck="false"
          />
        </label>
        <div class="skill-toolbar">
          <button
            type="submit"
            class="primary-button"
            :disabled="busy || !valid || !dirty"
          >
            {{ busy ? t('Saving…') : t('Save skill') }}
          </button>
          <button
            v-if="selected"
            type="button"
            class="secondary-button"
            :disabled="busy"
            @click="remove"
          >
            {{ t('Delete skill') }}
          </button>
        </div>
      </form>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-if="notice"
        role="status"
      >
        {{ notice }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.skill-toolbar, .skill-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
label { display: grid; gap: 8px; margin-top: 12px; }
textarea { width: 100%; resize: vertical; font-family: monospace; }
.skill-list .active { outline: 2px solid var(--accent); }
</style>
