<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GlobalSettings } from '../../../shared/types';
import { Keyboard, RotateCcw } from '../../icons';
import { comboFromEvent, keybindingActions, resolveKeybindings, type KeybindingAction } from '../../state/keybindings';
import { t } from '../../theme/themes';

const overrides = defineModel<GlobalSettings['keybindings']>({ required: true });

// Shortcuts: click a binding, press the new combo. Escape cancels, Backspace unbinds.
const recording = ref<KeybindingAction | ''>('');
const bindings = computed(() => resolveKeybindings(overrides.value));
function conflictFor(id: KeybindingAction) {
  const combo = bindings.value[id];
  return combo
    ? keybindingActions.find((action) => action.id !== id && bindings.value[action.id] === combo)
    : undefined;
}
function setBinding(id: KeybindingAction, combo: string) {
  const fallback = keybindingActions.find((action) => action.id === id)?.defaultKey;
  if (combo === fallback) delete overrides.value[id];
  else overrides.value[id] = combo;
}
function record(event: KeyboardEvent, id: KeybindingAction) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    recording.value = '';
    return;
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    setBinding(id, '');
    recording.value = '';
    return;
  }
  const combo = comboFromEvent(event);
  if (!combo) return;
  setBinding(id, combo);
  recording.value = '';
}
</script>

<template>
  <h3><Keyboard :size="15" /> {{ t('Keyboard shortcuts') }}</h3>
  <p class="muted">
    {{
      t(
        'Click a shortcut, then press the new key combination. Escape cancels; Backspace removes the shortcut.',
      )
    }}
  </p>
  <div class="keybinding-list">
    <div
      v-for="action in keybindingActions"
      :key="action.id"
      class="keybinding-row"
    >
      <span>{{ t(action.name)
      }}<small
        v-if="conflictFor(action.id)"
        class="error-text"
      >
        ·
        {{
          t('also used by {name}', { name: t(conflictFor(action.id)?.name ?? '') })
        }}</small></span>
      <button
        type="button"
        class="keybinding-key"
        :class="{ recording: recording === action.id }"
        :aria-label="t('Change shortcut for {name}', { name: t(action.name) })"
        @click="recording = action.id"
        @blur="recording === action.id && (recording = '')"
        @keydown="recording === action.id && record($event, action.id)"
      >
        {{
          recording === action.id ? t('Press keys…') : bindings[action.id] || t('Unbound')
        }}
      </button><button
        type="button"
        class="icon-button"
        :title="t('Reset to default')"
        :disabled="!(action.id in overrides)"
        @click="delete overrides[action.id]"
      >
        <RotateCcw :size="14" />
      </button>
    </div>
  </div>
</template>
