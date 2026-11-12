<script setup lang="ts">
import { computed, nextTick, ref, toRaw, watch, onBeforeUnmount } from 'vue';
import {
  ChevronDown,
  Check,
  LoaderCircle,
  TriangleAlert,
  Settings2,
  Search,
  Wrench,
  Brain,
  Eye,
  RefreshCw,
} from '../../icons';
import {
  effectiveProviders,
  providerName,
  reasoningOff,
  type GlobalSettings,
  type ModelInfo,
  type ProviderCatalog,
  type ProviderConfig,
  type Workspace,
} from '../../../shared/types';
import { rpc } from '../../services/api';
import {
  formatBytes,
  formatContext,
  formatSpeed,
  modelKey,
  type ModelUsage,
} from '../../utils/format';
import { t } from '../../theme/themes';

const props = defineProps<{
  global: GlobalSettings;
  workspace?: Workspace;
  label: string;
  disabled: boolean;
  title: string;
  usage: Map<string, ModelUsage>;
  /**
   * pick: choose a model and effort for a one-off action (second opinion, re-run, switch) and emit it, without
   * changing settings. The trigger is a small text button and the footer confirms with `action`.
   */
  mode?: 'pick';
  action?: string;
  /** Pick mode: offer a free-text note sent along with the choice (what a reviewer should focus on). */
  note?: boolean;
}>();
const emit = defineEmits<{
  saved: [];
  settings: [];
  error: [message: string];
  pick: [choice: { providerId: string; model: string; effort?: string; note?: string }];
}>();
const picking = computed(() => props.mode === 'pick');
/** In pick mode: the row clicked, and the effort chosen for it. */
const picked = ref<Row>();
const pickedEffort = ref('');
const pickedNote = ref('');
/** Opens downward or right-aligned when there is no room above or to the right of the trigger. */
const menu = ref<HTMLElement>();
/** Fixed position for the menu, which is moved to <body> so iframes and clipped containers never cover it. */
const position = ref<Record<string, string>>({});
function place() {
  const rect = root.value?.getBoundingClientRect();
  if (!rect) return;
  const width = Math.min(480, window.innerWidth - 16);
  const height = Math.min(520, window.innerHeight * 0.7);
  const below = rect.top < height + 20 && window.innerHeight - rect.bottom > rect.top;
  const left = Math.max(8, Math.min(rect.left - 10, window.innerWidth - width - 8));
  position.value = {
    left: `${left}px`,
    width: `${width}px`,
    height: `${Math.min(height, (below ? window.innerHeight - rect.bottom : rect.top) - 18)}px`,
    ...(below
      ? { top: `${rect.bottom + 8}px` }
      : { bottom: `${window.innerHeight - rect.top + 8}px` }),
  };
}

const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const query = ref('');
const filter = ref<string>('all');
const activeIndex = ref(0);
const catalog = ref<ProviderCatalog[]>([]);
const root = ref<HTMLElement>();
const search = ref<HTMLInputElement>();
const list = ref<HTMLElement>();

// The first enabled provider in the workspace's effective order is the one a new prompt starts with.
const providers = computed(() => effectiveProviders(props.global, props.workspace));
const current = computed(() => providers.value.find((provider) => provider.enabled));
const entryFor = (provider: ProviderConfig) =>
  catalog.value.find((entry) => entry.providerId === provider.id);

interface Row {
  provider: ProviderConfig;
  model: ModelInfo;
  usage?: ModelUsage;
  selected: boolean;
}
interface Section {
  provider: ProviderConfig;
  rows: Row[];
  error?: string;
  total: number;
}

const sections = computed<Section[]>(() => {
  const needle = query.value.trim().toLowerCase();
  return providers.value
    .filter((provider) => filter.value === 'all' || filter.value === provider.id)
    .map((provider) => {
      const entry = entryFor(provider);
      const listed = entry?.models ?? [];
      const models = listed.filter(
        (model) => !needle || `${model.id} ${model.name ?? ''}`.toLowerCase().includes(needle),
      );
      // Loaded models answer immediately, so they come first; then models you have used. Unlisted IDs go last;
      // otherwise keep the provider's own order, which puts its recommended models first.
      const rows = models
        .map((model) => ({
          provider,
          model,
          usage: props.usage.get(modelKey(provider.kind, model.id)),
          selected: picking.value
            ? picked.value?.provider.id === provider.id && picked.value.model.id === model.id
            : current.value?.id === provider.id && current.value.model === model.id,
        }))
        .sort(
          (a, b) =>
            Number(a.model.unlisted ?? false) - Number(b.model.unlisted ?? false) ||
            Number(b.model.loaded ?? false) - Number(a.model.loaded ?? false) ||
            Number(Boolean(b.usage)) - Number(Boolean(a.usage)) ||
            models.indexOf(a.model) - models.indexOf(b.model),
        );
      return { provider, rows, error: entry?.error, total: entry?.models.length ?? 0 };
      // While searching, providers without a match only add noise.
    })
    .filter((section) => !needle || section.rows.length);
});
const rows = computed(() => sections.value.flatMap((section) => section.rows));
const missing = computed(() => {
  const entry = current.value && entryFor(current.value);
  return current.value?.model &&
    entry &&
    !entry.error &&
    entry.models.length &&
    !entry.models.some((model) => model.id === current.value!.model)
    ? current.value.model
    : '';
});
const currentInfo = computed(
  () =>
    current.value &&
    entryFor(current.value)?.models.find((model) => model.id === current.value!.model),
);

watch([query, filter], () => {
  activeIndex.value = 0;
});

function details(model: ModelInfo): string {
  return [
    model.name && model.name !== model.id ? model.id : undefined,
    model.parameters,
    model.quantization,
    formatBytes(model.sizeBytes),
    formatContext(model.contextLength),
    model.description,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function load(refresh = false) {
  loading.value = true;
  try {
    catalog.value = await rpc<ProviderCatalog[]>('provider.catalog', { refresh });
  } catch (failure) {
    emit('error', failure instanceof Error ? failure.message : String(failure));
  } finally {
    loading.value = false;
  }
}
function outside(event: PointerEvent) {
  const target = event.target as Node;
  if (!root.value?.contains(target) && !menu.value?.contains(target)) close();
}
function close() {
  open.value = false;
  window.removeEventListener('pointerdown', outside);
  window.removeEventListener('resize', place);
}
async function show() {
  if (props.disabled || !props.workspace) return;
  place();
  window.addEventListener('resize', place);
  picked.value = undefined;
  pickedEffort.value = '';
  open.value = true;
  query.value = '';
  filter.value = 'all';
  window.addEventListener('pointerdown', outside);
  void load(true);
  await nextTick();
  search.value?.focus();
  // Start on the current model so Enter keeps it and arrows move from it.
  activeIndex.value = Math.max(
    0,
    rows.value.findIndex((row) => row.selected),
  );
}
onBeforeUnmount(close);
defineExpose({ show });

async function move(step: number) {
  if (!rows.value.length) return;
  activeIndex.value = (activeIndex.value + step + rows.value.length) % rows.value.length;
  await nextTick();
  list.value?.querySelector('.model-option.active')?.scrollIntoView({ block: 'nearest' });
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    void move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    void move(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const row = rows.value[activeIndex.value];
    if (row) void choose(row);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

/** Saves a change to the app-wide lineup, and to the workspace's own order when it has one. */
async function saveProviders(
  change: (providers: ProviderConfig[]) => void,
  changeWorkspace: ((workspace: Workspace) => void) | undefined,
  closeAfter: boolean,
) {
  const global = structuredClone(toRaw(props.global));
  change(global.providers);
  saving.value = true;
  try {
    await rpc('global.settings', { settings: global });
    if (changeWorkspace && props.workspace?.settings.fallback) {
      const workspace = structuredClone(toRaw(props.workspace));
      changeWorkspace(workspace);
      await rpc('workspace.settings', { workspaceId: workspace.id, settings: workspace.settings });
    }
    emit('saved');
    if (closeAfter) close();
  } catch (failure) {
    emit('error', failure instanceof Error ? failure.message : String(failure));
  } finally {
    saving.value = false;
  }
}

/** Picking a model sets it on its connection, enables it and moves it to the front of the fallback order. */
/**
 * Effort choices for a model: its own levels, plus Off where reasoning can be turned off (Claude, and local models
 * that think). '' is the model default.
 */
function effortOptions(provider: ProviderConfig | undefined, model: ModelInfo | undefined): string[] {
  if (!provider || !model) return [];
  const own = model.efforts ?? [];
  const local = ['ollama', 'lmstudio', 'openai'].includes(provider.kind);
  const canOff = (provider.kind === 'claude' || (local && model.thinking)) && !own.includes('none');
  const options = ['', ...own, ...(canOff ? [reasoningOff] : [])];
  return options.length > 1 ? options : [];
}
const effortTarget = computed(() =>
  picking.value
    ? picked.value && { provider: picked.value.provider, model: picked.value.model }
    : current.value && currentInfo.value && { provider: current.value, model: currentInfo.value },
);
const efforts = computed(() => effortOptions(effortTarget.value?.provider, effortTarget.value?.model));
const chosenEffort = computed(() =>
  picking.value ? pickedEffort.value : (current.value?.effort ?? ''),
);
function effortLabel(effort: string): string {
  if (effort === reasoningOff) return t('off');
  return effort || t('default');
}
function confirmPick() {
  if (!picked.value) return;
  emit('pick', {
    providerId: picked.value.provider.id,
    model: picked.value.model.id,
    effort: pickedEffort.value || undefined,
    note: pickedNote.value.trim() || undefined,
  });
  pickedNote.value = '';
  close();
}

async function choose(row: Row) {
  if (picking.value) {
    const same = picked.value?.provider.id === row.provider.id && picked.value.model.id === row.model.id;
    // A second click (or Enter) on the chosen row confirms.
    if (same) return confirmPick();
    picked.value = row;
    const options = effortOptions(row.provider, row.model);
    if (!options.includes(pickedEffort.value)) pickedEffort.value = '';
    return;
  }
  if (row.selected) {
    close();
    return;
  }
  await saveProviders(
    (providers) => {
      const [provider] = providers.splice(
        providers.findIndex((provider) => provider.id === row.provider.id),
        1,
      );
      // An effort the new model does not accept would fail the run; fall back to the model's default.
      const effort =
        provider.effort && effortOptions(provider, row.model).includes(provider.effort)
          ? provider.effort
          : undefined;
      providers.unshift({ ...provider, model: row.model.id, enabled: true, effort });
    },
    (workspace) => {
      const fallback = workspace.settings.fallback ?? [];
      workspace.settings.fallback = [
        { providerId: row.provider.id, enabled: true },
        ...fallback.filter((entry) => entry.providerId !== row.provider.id),
      ];
    },
    true,
  );
}

async function chooseEffort(effort: string) {
  if (picking.value) {
    pickedEffort.value = effort;
    return;
  }
  const target = current.value;
  if (!target) return;
  await saveProviders(
    (providers) => {
      const provider = providers.find((provider) => provider.id === target.id);
      if (provider) provider.effort = effort || undefined;
    },
    undefined,
    false,
  );
}
</script>

<template>
  <div
    ref="root"
    class="model-picker"
  >
    <button
      v-if="picking"
      type="button"
      class="text-button"
      :disabled="disabled || !workspace"
      :title="title"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open ? close() : show()"
    >
      <slot />{{ label }}<ChevronDown :size="11" />
    </button>
    <button
      v-else
      type="button"
      class="model-selector"
      :class="{ unset: !current?.model && current?.kind !== 'claude', open }"
      :disabled="disabled || !workspace"
      :title="title"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="open ? close() : show()"
    >
      <span
        class="model-dot"
        :class="current?.kind"
      /><span class="model-selector-label">{{
        label
      }}</span><TriangleAlert
        v-if="currentInfo && currentInfo.tools === false"
        :size="12"
        class="warning-text"
        :aria-label="t('This model does not support tool use')"
      /><ChevronDown :size="12" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="model-menu floating"
        :style="position"
        @keydown="keydown"
      >
        <div class="model-menu-search">
          <Search :size="14" />
          <input
            ref="search"
            v-model="query"
            :placeholder="t('Search models…')"
            :aria-label="t('Search models')"
            role="combobox"
            aria-controls="model-options"
            :aria-activedescendant="rows[activeIndex] ? `model-option-${activeIndex}` : undefined"
            spellcheck="false"
          ><button
            type="button"
            class="icon-button"
            :title="t('Refresh model list')"
            :disabled="loading"
            @click="load(true)"
          >
            <RefreshCw
              :size="13"
              :class="{ spin: loading }"
            />
          </button>
        </div>
        <div
          class="model-menu-tabs"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="filter === 'all'"
            :class="{ active: filter === 'all' }"
            @click="filter = 'all'"
          >
            {{ t('All') }}
          </button><button
            v-for="provider in providers"
            :key="provider.id"
            type="button"
            role="tab"
            :aria-selected="filter === provider.id"
            :class="{ active: filter === provider.id }"
            @click="filter = provider.id"
          >
            {{ providerName(provider)
            }}<span v-if="entryFor(provider)">{{
              entryFor(provider)!.error ? '!' : entryFor(provider)!.models.length
            }}</span>
          </button>
        </div>
        <p
          v-if="missing"
          class="model-menu-warning"
        >
          <TriangleAlert :size="13" />
          {{ t('“{name}” is not installed. Pick another model.', { name: missing }) }}
        </p>
        <div
          id="model-options"
          ref="list"
          class="model-menu-list"
          role="listbox"
        >
          <div
            v-if="loading && !catalog.length"
            class="model-menu-empty"
          >
            <LoaderCircle
              :size="14"
              class="spin"
            /> {{ t('Looking for models…') }}
          </div>
          <p
            v-else-if="query && !sections.length"
            class="model-menu-empty"
          >
            {{ t('No models match “{query}”.', { query }) }}
          </p>
          <template v-else>
            <section
              v-for="section in sections"
              :key="section.provider.id"
            >
              <header class="model-menu-group">
                {{ providerName(section.provider)
                }}<span v-if="section.provider.endpoint && section.provider.kind !== 'claude'">{{
                  section.provider.endpoint.replace(/^https?:\/\//, '').replace(/\/v1\/?$/, '')
                }}</span>
              </header>
              <p
                v-if="section.error"
                class="model-menu-note"
              >
                {{ section.error }}
              </p>
              <p
                v-else-if="!loading && !section.total"
                class="model-menu-note"
              >
                {{ t('No models installed.') }}
              </p>
              <button
                v-for="row in section.rows"
                :id="`model-option-${rows.indexOf(row)}`"
                :key="row.model.id"
                type="button"
                role="option"
                :aria-selected="row.selected"
                class="model-option"
                :class="{ active: rows.indexOf(row) === activeIndex, selected: row.selected }"
                :disabled="saving"
                @mousemove="activeIndex = rows.indexOf(row)"
                @click="choose(row)"
              >
                <span class="model-option-main">
                  <span class="model-option-name">
                    <span
                      v-if="row.model.loaded"
                      class="model-loaded"
                      :title="t('Loaded in memory: answers without a load delay')"
                    />
                    {{ row.model.name || row.model.id || t('default')
                    }}<span
                      v-if="row.model.isDefault"
                      class="model-default"
                    >{{ t('default') }}</span><span
                      v-else-if="row.model.unlisted"
                      class="model-default"
                      :title="t('Not in this account\'s model list; the provider may reject it')"
                    >{{ t('not listed') }}</span>
                  </span>
                  <span class="model-option-details">{{ details(row.model) }}</span>
                </span>
                <span class="model-option-meta">
                  <span
                    v-if="row.usage?.speed"
                    class="model-speed"
                    :title="
                      t('Your average decode speed over {count} prompt(s)', {
                        count: row.usage.prompts,
                      })
                    "
                  >{{ formatSpeed(row.usage.speed) }}</span>
                  <span
                    v-if="row.model.tools === false"
                    class="model-cap warn"
                    :title="t('No tool use: this model cannot read or edit files as an agent')"
                  ><TriangleAlert :size="12" /></span>
                  <span
                    v-else-if="row.model.tools"
                    class="model-cap"
                    :title="t('Supports tool use')"
                  ><Wrench :size="12" /></span>
                  <span
                    v-if="row.model.thinking"
                    class="model-cap"
                    :title="t('Thinking model')"
                  ><Brain :size="12" /></span>
                  <span
                    v-if="row.model.vision"
                    class="model-cap"
                    :title="t('Accepts images')"
                  ><Eye :size="12" /></span>
                  <Check
                    v-if="row.selected"
                    :size="15"
                    class="model-check"
                  />
                </span>
              </button>
            </section>
          </template>
        </div>
        <div
          v-if="efforts.length"
          class="model-effort"
          role="radiogroup"
          :aria-label="t('Reasoning effort')"
        >
          <Brain :size="13" /><span>{{ t('Effort') }}</span><button
            v-for="effort in efforts"
            :key="effort"
            type="button"
            role="radio"
            :aria-checked="chosenEffort === effort"
            :class="{ active: chosenEffort === effort }"
            :disabled="saving"
            :title="
              effort === reasoningOff
                ? t('No reasoning: faster and cheaper, for simple tasks')
                : effort
                  ? ''
                  : `${t('Model default')}${effortTarget?.model.defaultEffort ? ` (${effortTarget.model.defaultEffort})` : ''}`
            "
            @click="chooseEffort(effort)"
          >
            {{ effortLabel(effort) }}
          </button>
        </div>
        <textarea
          v-if="picking && note"
          v-model="pickedNote"
          class="model-menu-note-input"
          rows="2"
          :placeholder="t('Optional: what should the reviewer focus on?')"
          @keydown.stop
        />
        <footer
          v-if="picking"
          class="model-menu-footer"
        >
          <span>{{ picked ? `${providerName(picked.provider)} / ${picked.model.name || picked.model.id}` : t('Pick a model') }}</span>
          <button
            type="button"
            class="primary-button small-button"
            :disabled="!picked"
            @click="confirmPick"
          >
            {{ action ?? t('Use this model') }}
          </button>
        </footer>
        <footer
          v-else
          class="model-menu-footer"
        >
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ t('move') }} · <kbd>Enter</kbd> {{ t('select') }} ·
            <kbd>Esc</kbd> {{ t('close') }}</span>
          <button
            type="button"
            class="text-button"
            @click="
              close();
              emit('settings');
            "
          >
            <Settings2 :size="13" /> {{ t('Fallback & endpoints') }}
          </button>
        </footer>
      </div>
    </Teleport>
  </div>
</template>
