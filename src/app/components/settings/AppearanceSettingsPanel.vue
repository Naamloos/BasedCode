<script setup lang="ts">
import { computed, ref, toRaw } from 'vue';
import type { AppLanguage, CustomTheme, GlobalSettings, ThemeMode } from '../../../shared/types';
import { Check, Palette, Plus, Sparkles, Trash2 } from '../../icons';
import { effectsEnabled } from '../../theme/effects';
import { activeSlot, availableThemes, flamePalettes, t, themes } from '../../theme/themes';
import AppSelect from '../common/AppSelect.vue';
import ThemeEditorDialog from './ThemeEditorDialog.vue';

const settings = defineModel<GlobalSettings>({ required: true });

function setLanguage(value: string): void {
  settings.value.language = value as AppLanguage;
}

// Theme picker: two slots, the mode picks which one is live.
const modeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];
const themeSlot = ref<'dark' | 'light'>(activeSlot(settings.value.appearance));
const themeQuery = ref('');
const allThemes = computed(() => availableThemes(settings.value.appearance));
const editingThemeId = ref('');
const editingTheme = ref<CustomTheme>();
function createTheme() {
  const base = allThemes.value.find((theme) => theme.id === slotTheme.value) ?? themes[0];
  const tokens = { ...base.tokens };
  for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(tokens[key])) tokens[key] = themes[0].tokens[key];
  }
  editingThemeId.value = '';
  editingTheme.value = {
    id: 'custom-' + crypto.randomUUID().replaceAll('-', '').slice(0, 32),
    name: base.name.slice(0, 55) + ' copy',
    scheme: base.scheme,
    tokens,
  };
}
const themeMenu = ref<{ id: string; x: number; y: number }>();
function openThemeMenu(event: MouseEvent, id: string) {
  themeMenu.value = { id, x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 90) };
}
function closeThemeMenu() {
  themeMenu.value = undefined;
}
function editTheme(id = slotTheme.value) {
  closeThemeMenu();
  const theme = settings.value.appearance.customThemes?.find((item) => item.id === id);
  if (!theme) return;
  editingThemeId.value = theme.id;
  editingTheme.value = structuredClone(toRaw(theme));
}
function closeThemeEditor() {
  editingTheme.value = undefined;
  editingThemeId.value = '';
}
function saveTheme(theme: CustomTheme) {
  const appearance = settings.value.appearance;
  appearance.customThemes = [...(appearance.customThemes ?? []).filter((item) => item.id !== theme.id), theme];
  themeQuery.value = '';
  pickTheme(theme.id);
  closeThemeEditor();
}
function deleteTheme(id = editingThemeId.value) {
  closeThemeMenu();
  const appearance = settings.value.appearance;
  appearance.customThemes = appearance.customThemes?.filter((theme) => theme.id !== id);
  if (appearance.theme === id) appearance.theme = 'based';
  if (appearance.lightTheme === id) appearance.lightTheme = 'normie';
  closeThemeEditor();
}
const slotTheme = computed(() =>
  themeSlot.value === 'dark' ? settings.value.appearance.theme : settings.value.appearance.lightTheme,
);
function themeName(id: string) {
  return allThemes.value.find((theme) => theme.id === id)?.name ?? id;
}
function pickTheme(id: string) {
  if (themeSlot.value === 'dark') settings.value.appearance.theme = id;
  else settings.value.appearance.lightTheme = id;
}
const themeGroups = computed(() => {
  const words = themeQuery.value.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = allThemes.value.filter((theme) => {
    const text = `${theme.name} ${theme.tagline} ${theme.id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return [
    { label: 'BasedCode originals', items: matches.filter((x) => x.origin === 'original' && x.scheme === 'dark') },
    { label: 'Popular ports', items: matches.filter((x) => x.origin === 'port' && x.scheme === 'dark') },
    { label: 'Light', items: matches.filter((x) => x.origin !== 'custom' && x.scheme === 'light') },
    { label: 'Custom themes', items: matches.filter((x) => x.origin === 'custom') },
  ];
});
</script>

<template>
  <h3>{{ t('Language') }}</h3>
  <AppSelect
    :model-value="settings.language ?? 'en'"
    :aria-label="t('Language')"
    :options="[
      { value: 'en', label: t('English') },
      { value: 'nl', label: t('Dutch') },
      { value: 'based', label: t('Based') },
    ]"
    @update:model-value="setLanguage"
  />
  <h3>{{ t('Mode') }}</h3>
  <div
    class="seg-control"
    role="radiogroup"
    :aria-label="t('Mode')"
    :style="{ '--seg-count': 3, '--seg-index': modeOptions.findIndex((o) => o.value === settings.appearance.mode) }"
  >
    <button
      v-for="option in modeOptions"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="settings.appearance.mode === option.value"
      @click="settings.appearance.mode = option.value"
    >
      {{ t(option.label) }}
    </button>
  </div>
  <h3>{{ t('Theme') }}</h3>
  <div class="theme-editor-actions">
    <button
      type="button"
      class="secondary-button"
      :disabled="(settings.appearance.customThemes?.length ?? 0) >= 100"
      @click="createTheme"
    >
      <Plus :size="14" /> {{ t('Create theme') }}
    </button>
    <button
      v-if="settings.appearance.customThemes?.some((theme) => theme.id === slotTheme)"
      type="button"
      class="secondary-button"
      @click="editTheme()"
    >
      <Palette :size="14" /> {{ t('Edit theme') }}
    </button>
  </div>
  <ThemeEditorDialog
    v-if="editingTheme"
    :theme="editingTheme"
    :existing="!!editingThemeId"
    @close="closeThemeEditor"
    @save="saveTheme"
    @delete="deleteTheme()"
  />
  <div
    class="seg-control"
    role="tablist"
    :aria-label="t('Theme slot')"
    :style="{ '--seg-count': 2, '--seg-index': themeSlot === 'dark' ? 0 : 1 }"
  >
    <button
      type="button"
      role="tab"
      :aria-selected="themeSlot === 'dark'"
      @click="themeSlot = 'dark'"
    >
      {{ t('Dark theme') }} · {{ themeName(settings.appearance.theme) }}
    </button>
    <button
      type="button"
      role="tab"
      :aria-selected="themeSlot === 'light'"
      @click="themeSlot = 'light'"
    >
      {{ t('Light theme') }} · {{ themeName(settings.appearance.lightTheme) }}
    </button>
  </div>
  <input
    v-model="themeQuery"
    class="theme-search"
    type="search"
    autocomplete="off"
    :placeholder="t('Search themes')"
    :aria-label="t('Search themes')"
  >
  <template
    v-for="group in themeGroups"
    :key="group.label"
  >
    <h4
      v-if="group.items.length"
      class="section-label"
    >
      {{ t(group.label) }}
    </h4>
    <div
      v-if="group.items.length"
      class="theme-grid"
    >
      <button
        v-for="theme in group.items"
        :key="theme.id"
        type="button"
        class="theme-card"
        :class="{
          selected: slotTheme === theme.id,
          rgb: theme.tokens['--accent'].includes('--rgb-hue'),
        }"
        :style="{
          ...theme.tokens,
          background: theme.tokens['--surface'],
          color: theme.tokens['--text'],
        }"
        :aria-pressed="slotTheme === theme.id"
        @click="pickTheme(theme.id)"
        @contextmenu="theme.origin === 'custom' && ($event.preventDefault(), openThemeMenu($event, theme.id))"
      >
        <span
          class="theme-preview"
          :style="{ background: theme.tokens['--bg'] }"
        >
          <span
            class="theme-preview-surface"
            :style="{ background: theme.tokens['--surface-raised'] }"
          >
            <span
              class="theme-preview-line"
              :style="{ background: theme.tokens['--text'] }"
            />
            <span
              class="theme-preview-line short"
              :style="{ background: theme.tokens['--muted'] }"
            />
            <span class="theme-preview-foot">
              <span
                class="theme-preview-button"
                :style="{ background: theme.tokens['--accent'] }"
              />
              <span
                class="theme-preview-dot"
                :style="{ background: theme.tokens['--success'] }"
              />
              <span
                class="theme-preview-dot"
                :style="{ background: theme.tokens['--danger'] }"
              />
            </span>
          </span>
        </span>
        <strong>{{ theme.name }}<Check
          v-if="slotTheme === theme.id"
          :size="13"
        /></strong>
        <small :style="{ color: theme.tokens['--muted'] }">{{ t(theme.tagline) }}</small>
      </button>
    </div>
  </template>
  <Teleport
    v-if="themeMenu"
    to="body"
  >
    <div
      class="theme-menu-backdrop"
      @click="closeThemeMenu"
      @contextmenu.prevent="closeThemeMenu"
      @keydown.esc="closeThemeMenu"
    />
    <div
      class="chat-menu at-cursor theme-menu"
      role="menu"
      :style="{ left: `${themeMenu.x}px`, top: `${themeMenu.y}px` }"
    >
      <button
        type="button"
        role="menuitem"
        @click="editTheme(themeMenu.id)"
      >
        <Palette :size="14" /> {{ t('Edit theme') }}
      </button>
      <button
        type="button"
        role="menuitem"
        class="danger"
        @click="deleteTheme(themeMenu.id)"
      >
        <Trash2 :size="14" /> {{ t('Delete theme') }}
      </button>
    </div>
  </Teleport>

  <h3><Sparkles :size="15" /> {{ t('Flames') }}</h3>
  <label class="checkbox"><input
                            v-model="effectsEnabled"
                            autocomplete="off"
                            type="checkbox"
                          >
    {{ t("Flame effects (follows your system's reduced-motion setting)") }}</label>
  <div class="flame-grid">
    <button
      v-for="palette in flamePalettes"
      :key="palette.id"
      type="button"
      class="flame-card"
      :class="{ selected: settings.appearance.flame === palette.id }"
      :aria-pressed="settings.appearance.flame === palette.id"
      @click="settings.appearance.flame = palette.id"
    >
      <span
        class="flame-swatch"
        :style="{
          background: palette.rainbow
            ? 'linear-gradient(to top, #f00, #ff0, #0f0, #0ff, #00f, #f0f)'
            : `linear-gradient(to top, ${palette.colors[0]}, ${palette.colors[1]} 40%, ${palette.colors[2]} 75%, ${palette.colors[3]})`,
        }"
      />{{ t(palette.name) }}
    </button>
  </div>
</template>
