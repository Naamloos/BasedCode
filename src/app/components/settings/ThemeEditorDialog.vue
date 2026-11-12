<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, toRaw } from 'vue';
import type { CustomTheme } from '../../../shared/types';
import { X } from '../../icons';
import { t } from '../../theme/themes';
import { generateThemeTokens } from '../../theme/customTheme';

const props = defineProps<{ theme: CustomTheme; existing: boolean }>();
const emit = defineEmits<{ close: []; save: [theme: CustomTheme]; delete: [] }>();
const draft = ref<CustomTheme>(structuredClone(toRaw(props.theme)));
const dialog = ref<HTMLDialogElement>();
const advanced = ref(false);
const seeds = ref({
  background: draft.value.tokens['--bg'].slice(0, 7),
  text: draft.value.tokens['--text'].slice(0, 7),
  accent: draft.value.tokens['--accent'].slice(0, 7),
});
const colors = [
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent' },
] as const;
const valid = computed(() => draft.value.name.trim() && Object.values(draft.value.tokens).every((value) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)));
const previousFocus = document.activeElement as HTMLElement | null;
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => previousFocus?.focus());
function generate() {
  draft.value.tokens = generateThemeTokens(seeds.value.background, seeds.value.text, seeds.value.accent, draft.value.scheme);
}
function save() {
  if (valid.value) emit('save', { ...structuredClone(toRaw(draft.value)), name: draft.value.name.trim() });
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="small-modal theme-editor-dialog"
      aria-labelledby="theme-editor-title"
      @cancel.prevent="emit('close')"
    >
      <form @submit.prevent="save">
        <header class="modal-header">
          <h2 id="theme-editor-title">
            {{ t(existing ? 'Edit theme' : 'Create theme') }}
          </h2>
          <button
            type="button"
            class="icon-button"
            :aria-label="t('Close')"
            @click="emit('close')"
          >
            <X :size="18" />
          </button>
        </header>
        <div class="theme-editor-body">
          <label>{{ t('Theme name') }}<input
            v-model="draft.name"
            maxlength="60"
            required
            autofocus
          ></label>
          <div
            class="seg-control"
            :style="{ '--seg-count': 2, '--seg-index': draft.scheme === 'dark' ? 0 : 1 }"
            :aria-label="t('Color scheme')"
          >
            <button
              v-for="scheme in (['dark', 'light'] as const)"
              :key="scheme"
              type="button"
              :aria-pressed="draft.scheme === scheme"
              @click="draft.scheme = scheme; generate()"
            >
              {{ t(scheme === 'dark' ? 'Dark' : 'Light') }}
            </button>
          </div>
          <p class="theme-editor-hint">
            {{ t('Pick three colors. Surface shades, borders, and highlights are generated for you.') }}
          </p>
          <div class="theme-seed-grid">
            <label
              v-for="color in colors"
              :key="color.key"
              class="theme-seed"
            >
              <span>{{ t(color.label) }}</span>
              <input
                v-model="seeds[color.key]"
                type="color"
                @input="generate"
              >
              <span class="theme-editor-hint">{{ seeds[color.key] }}</span>
            </label>
          </div>
          <button
            type="button"
            class="secondary-button"
            :aria-expanded="advanced"
            @click="advanced = !advanced"
          >
            {{ t(advanced ? 'Hide advanced colors' : 'Advanced · edit individual colors') }}
          </button>
          <div
            v-if="advanced"
            class="theme-token-grid"
          >
            <label
              v-for="(_, token) in draft.tokens"
              :key="token"
              class="theme-token"
            >
              <span>{{ token.slice(2).replaceAll('-', ' ') }}</span>
              <input
                type="color"
                :aria-label="token + ' color'"
                :value="draft.tokens[token].slice(0, 7)"
                @input="draft.tokens[token] = ($event.target as HTMLInputElement).value"
              >
              <input
                v-model="draft.tokens[token]"
                :aria-label="token + ' hex value'"
                maxlength="9"
                spellcheck="false"
                :aria-invalid="!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(draft.tokens[token])"
              >
            </label>
          </div>
          <p class="theme-editor-hint">
            {{ t('Apply to add this theme to your settings, then save settings to keep it.') }}
          </p>
        </div>
        <footer class="modal-footer">
          <button
            v-if="existing"
            type="button"
            class="secondary-button theme-delete"
            @click="emit('delete')"
          >
            {{ t('Delete theme') }}
          </button>
          <button
            type="button"
            class="secondary-button"
            @click="emit('close')"
          >
            {{ t('Cancel') }}
          </button>
          <button
            type="submit"
            class="primary-button"
            :disabled="!valid"
          >
            {{ t('Apply theme') }}
          </button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>
