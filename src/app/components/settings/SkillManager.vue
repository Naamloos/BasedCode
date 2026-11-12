<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Plus, RefreshCw, Sparkles, Trash2 } from '../../icons';
import type { Workspace } from '../../../shared/types';
import { slashCommands } from '../../../shared/commands';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { t } from '../../theme/themes';
import AppSelect from '../common/AppSelect.vue';
import FormDialog from '../common/FormDialog.vue';

const props = defineProps<{ workspace?: Workspace }>();

type Scope = 'workspace' | 'global';
type Source = 'basedcode' | 'claude' | 'codex' | 'agents';
interface Skill {
  name: string;
  scope: Scope;
  source: Source;
  path: string;
  content: string;
  description?: string;
  /** False when a skill with the same name in an earlier folder wins. */
  active: boolean;
}
// Same order as the server's lookup order, so the list reads top to bottom like the agent resolves names.
const sources: { id: Source; label: string }[] = [
  { id: 'basedcode', label: 'BasedCode' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'agents', label: 'Agents (shared)' },
];
const folder = (scope: Scope, source: Source) => `${scope === 'global' ? '~/' : ''}.${source}/skills`;
const sourceLabel = (source: Source) => sources.find((item) => item.id === source)!.label;

const skills = ref<Skill[]>([]);
const filter = ref('');
const locations = ['all', 'workspace', 'global'] as const;
const location = ref<(typeof locations)[number]>('all');
const loading = ref(false);
const error = ref('');
const notice = ref('');

const groups = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  const scopes: Scope[] = props.workspace ? ['workspace', 'global'] : ['global'];
  return scopes
    .filter((scope) => location.value === 'all' || location.value === scope)
    .map((scope) => ({
      scope,
      title: scope === 'workspace' ? t('This workspace') : t('Global · every workspace'),
      folders: sources
        .map((source) => ({
          source,
          path: folder(scope, source.id),
          skills: skills.value.filter(
            (skill) =>
              skill.scope === scope &&
              skill.source === source.id &&
              (!needle || `${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(needle)),
          ),
        }))
        .filter((group) => group.skills.length),
    }));
});
const counts = computed(() => ({
  all: skills.value.length,
  workspace: skills.value.filter((skill) => skill.scope === 'workspace').length,
  global: skills.value.filter((skill) => skill.scope === 'global').length,
}));

async function load() {
  loading.value = true;
  error.value = '';
  const workspaceId = props.workspace?.id;
  try {
    const result = await rpc<Skill[]>('skills.list', workspaceId ? { workspaceId } : {});
    if (props.workspace?.id === workspaceId) skills.value = result;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    loading.value = false;
  }
}

// Editor dialog: `original` is the skill being edited, absent while creating one.
interface Draft {
  original?: Skill;
  name: string;
  target: string;
  content: string;
}
const editing = ref<Draft>();
watch(
  () => props.workspace?.id,
  () => {
    skills.value = [];
    editing.value = undefined;
    if (!props.workspace) location.value = 'all';
    void load();
  },
  { immediate: true },
);
const busy = ref(false);
const dialogError = ref('');
const targets = computed(() =>
  (props.workspace ? (['workspace', 'global'] as const) : (['global'] as const)).flatMap((scope) =>
    sources.map((source) => ({
      value: `${scope}:${source.id}`,
      label: `${scope === 'workspace' ? t('This workspace') : t('Global')} · ${folder(scope, source.id)}`,
    })),
  ),
);
const draftTarget = computed(() => {
  const [scope, source] = (editing.value?.target ?? 'global:basedcode').split(':') as [Scope, Source];
  return { scope, source };
});
const nameValid = computed(
  () => !!editing.value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editing.value.name) && editing.value.name.length <= 64,
);
const reserved = computed(() => slashCommands.some((command) => command.name === editing.value?.name));
const clash = computed(() => {
  const draft = editing.value;
  if (!draft || draft.original) return undefined;
  return skills.value.find(
    (skill) => skill.name === draft.name && skill.scope === draftTarget.value.scope && skill.source === draftTarget.value.source,
  );
});
const valid = computed(
  () =>
    nameValid.value &&
    !clash.value &&
    !!editing.value?.content.trim() &&
    editing.value.content.length <= 50_000,
);
const dirty = computed(() => {
  const draft = editing.value;
  if (!draft) return false;
  return draft.original ? draft.content !== draft.original.content : !!(draft.name || draft.content.trim());
});
const template = (name: string) =>
  `---\nname: ${name || 'my-skill'}\ndescription: When to use this skill, in one sentence.\n---\n\n# ${name || 'my-skill'}\n\n1. \n`;

function create() {
  dialogError.value = '';
  editing.value = {
    name: '',
    target: props.workspace ? 'workspace:basedcode' : 'global:basedcode',
    content: template(''),
  };
}
function edit(skill: Skill) {
  dialogError.value = '';
  editing.value = { original: skill, name: skill.name, target: `${skill.scope}:${skill.source}`, content: skill.content };
}
async function closeEditor() {
  if (busy.value) return;
  if (dirty.value && !(await confirmAction(t('Discard skill edits?'), t('Your unsaved instructions will be lost.'), t('Discard'))))
    return;
  editing.value = undefined;
}
async function save() {
  const draft = editing.value;
  if (!draft || !valid.value || busy.value) return;
  const { scope, source } = draftTarget.value;
  if (
    scope === 'global' &&
    !draft.original &&
    !(await confirmAction(
      t('Save global skill?'),
      t('{path} is available in every workspace and is not undone by prompt revert.', {
        path: `${folder(scope, source)}/${draft.name}/SKILL.md`,
      }),
      t('Save'),
    ))
  )
    return;
  busy.value = true;
  dialogError.value = '';
  try {
    await rpc('skills.save', {
      ...(props.workspace ? { workspaceId: props.workspace.id } : {}),
      scope,
      source,
      name: draft.name,
      content: draft.content,
      expectedContent: draft.original?.content,
    });
    editing.value = undefined;
    notice.value = t('Skill saved.');
    await load();
  } catch (failure) {
    dialogError.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
async function remove(skill: Skill) {
  if (busy.value) return;
  if (!(await confirmAction(t('Delete skill?'), `/${skill.name} · ${skill.path}`, t('Delete')))) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await rpc('skills.delete', {
      ...(props.workspace ? { workspaceId: props.workspace.id } : {}),
      scope: skill.scope,
      source: skill.source,
      name: skill.name,
      expectedContent: skill.content,
    });
    editing.value = undefined;
    notice.value = t('Skill deleted.');
    await load();
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (editing.value) dialogError.value = message;
    else error.value = message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="skill-manager">
    <h3>{{ t('Skills') }}</h3>
    <p class="muted">
      {{
        t(
          'Reusable instructions the agent activates with /name or @name. BasedCode reads skill folders of BasedCode, Claude Code, Codex and the shared .agents convention, in the workspace and in your home folder. When names clash, the first folder listed wins.',
        )
      }}
    </p>
    <div class="skill-toolbar">
      <input
        v-model="filter"
        type="search"
        autocomplete="off"
        :aria-label="t('Filter skills')"
        :placeholder="t('Filter skills')"
      >
      <div
        v-if="workspace"
        class="seg-control skill-scope-toggle"
        role="radiogroup"
        :aria-label="t('Location')"
        :style="{ '--seg-count': 3, '--seg-index': locations.indexOf(location) }"
      >
        <button
          v-for="option in locations"
          :key="option"
          type="button"
          role="radio"
          :aria-checked="location === option"
          @click="location = option"
        >
          {{ t(option === 'all' ? 'All' : option === 'workspace' ? 'Workspace' : 'Global') }}
          <span class="skill-count">{{ counts[option] }}</span>
        </button>
      </div>
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
        <Plus :size="14" /> {{ t('New skill') }}
      </button>
    </div>
    <p
      v-if="!workspace"
      class="muted small"
    >
      {{ t('Open a workspace to see and manage its own skills too.') }}
    </p>
    <p
      v-if="error"
      class="error-box"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="notice"
      class="muted small"
      role="status"
    >
      {{ notice }}
    </p>

    <div
      v-if="!loading && !skills.length"
      class="skill-empty"
    >
      <Sparkles :size="22" />
      <p>{{ t('No skills found yet. Create one, or drop a folder with a SKILL.md into any of the skill folders.') }}</p>
    </div>

    <section
      v-for="group in groups"
      v-show="group.folders.length"
      :key="group.scope"
      class="skill-scope"
    >
      <h4>{{ group.title }}</h4>
      <div
        v-for="entry in group.folders"
        :key="entry.source.id"
        class="skill-folder"
      >
        <header>
          <strong>{{ entry.source.label }}</strong>
          <code>{{ entry.path }}</code>
          <span class="spacer" />
          <span class="muted small">{{ entry.skills.length }}</span>
        </header>
        <ul>
          <li
            v-for="skill in entry.skills"
            :key="skill.path"
            :class="{ shadowed: !skill.active }"
          >
            <button
              type="button"
              class="skill-row"
              :title="skill.path"
              @click="edit(skill)"
            >
              <span class="skill-name">/{{ skill.name }}</span>
              <span class="skill-description">{{ skill.description ?? t('No description') }}</span>
              <span
                v-if="!skill.active"
                class="skill-badge"
                :title="t('A skill with the same name in an earlier folder is used instead.')"
              >{{ t('Shadowed') }}</span>
            </button>
            <button
              type="button"
              class="icon-button"
              :title="t('Delete skill')"
              :aria-label="t('Delete skill')"
              :disabled="busy"
              @click="remove(skill)"
            >
              <Trash2 :size="14" />
            </button>
          </li>
        </ul>
      </div>
    </section>
    <p
      v-if="skills.length && groups.every((group) => !group.folders.length)"
      class="muted"
    >
      {{ t('No skills match this filter.') }}
    </p>

    <FormDialog
      v-if="editing"
      wide
      :title="editing.original ? `/${editing.original.name}` : t('New skill')"
      @close="closeEditor"
      @submit="save"
    >
      <div class="form-grid">
        <label>{{ t('Skill name') }}
          <input
            v-model="editing.name"
            :disabled="busy || Boolean(editing.original)"
            autocomplete="off"
            maxlength="64"
            placeholder="review-code"
            :autofocus="!editing.original"
          >
        </label>
        <label>{{ t('Location') }}
          <AppSelect
            v-if="!editing.original"
            v-model="editing.target"
            :options="targets"
          />
          <input
            v-else
            :value="`${editing.original.scope === 'workspace' ? t('This workspace') : t('Global')} · ${sourceLabel(editing.original.source)}`"
            disabled
          >
        </label>
      </div>
      <p class="muted small">
        <template v-if="editing.original">
          <code>{{ editing.original.path }}</code>
        </template>
        <template v-else>
          {{ t('Use lowercase letters, digits and hyphens.') }}
          <code>{{ folder(draftTarget.scope, draftTarget.source) }}/{{ editing.name || 'name' }}/SKILL.md</code>
        </template>
      </p>
      <p
        v-if="reserved"
        class="muted small"
      >
        {{ t('This name is reserved. Activate it with /skill') }} {{ editing.name }}.
      </p>
      <p
        v-if="clash"
        class="warning-text small"
      >
        {{ t('A skill with this name already exists in that folder.') }}
      </p>
      <p
        v-if="editing.original && !editing.original.active"
        class="muted small"
      >
        {{ t('A skill with the same name in an earlier folder is used instead.') }}
      </p>
      <label>{{ t('Instructions (Markdown)') }}
        <textarea
          v-model="editing.content"
          class="code-input"
          :disabled="busy"
          rows="16"
          maxlength="50000"
          spellcheck="false"
          :autofocus="Boolean(editing.original)"
        />
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
          v-if="editing.original"
          type="button"
          class="secondary-button danger-action"
          :disabled="busy"
          @click="remove(editing.original)"
        >
          <Trash2 :size="14" /> {{ t('Delete skill') }}
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="busy"
          @click="closeEditor"
        >
          {{ t('Cancel') }}
        </button>
        <button
          type="submit"
          class="primary-button"
          :disabled="busy || !valid || !dirty"
        >
          {{ busy ? t('Saving…') : t('Save skill') }}
        </button>
      </template>
    </FormDialog>
  </section>
</template>

<style scoped>
.skill-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
.skill-toolbar input[type='search'] {
  flex: 1 1 180px;
  min-width: 0;
}
.skill-scope-toggle > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.skill-count {
  font-size: var(--fs-xs);
  color: var(--faint);
}
.skill-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 28px 16px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  color: var(--muted);
  text-align: center;
}
.skill-folder {
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  overflow: hidden;
}
.skill-folder > header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
}
.skill-folder > header code {
  color: var(--faint);
  font-size: var(--fs-xs);
}
.skill-folder ul {
  list-style: none;
  margin: 0;
  padding: 4px;
}
.skill-folder li {
  display: flex;
  align-items: center;
  gap: 4px;
}
.skill-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  text-align: start;
  cursor: pointer;
}
.skill-row:hover {
  background: var(--surface-hover);
}
.skill-name {
  flex-shrink: 0;
  font-family: var(--font-code);
  font-size: var(--fs-sm);
}
.skill-description {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.skill-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--tint-hover);
  color: var(--muted);
  font-size: var(--fs-xs);
}
li.shadowed .skill-name {
  color: var(--muted);
  text-decoration: line-through;
}
.form-grid code {
  font-size: var(--fs-xs);
}
</style>