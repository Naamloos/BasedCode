<script setup lang="ts">
/**
 * Hand a chat off to another mode: pick the mode, optionally add context, or cancel.
 * The parent does the hand-off; this only collects the choice.
 */
import { computed, nextTick, onMounted, ref } from 'vue';
import { guidedModes, type GuidedMode } from '../../../shared/chatModes';
import type { Chat, ChatMode } from '../../../shared/types';
import { t } from '../../theme/themes';
import ChatModeIcon from '../common/ChatModeIcon.vue';

const props = defineProps<{ chat: Chat; appIcon: string; initialMode?: Exclude<ChatMode, 'review'> }>();
const emit = defineEmits<{
  cancel: [];
  handOff: [choice: { mode: Exclude<ChatMode, 'review'>; context: string }];
}>();

type Target = Exclude<ChatMode, 'review'>;
const current = computed(() => props.chat.mode ?? 'default');
const options = computed(() =>
  [
    { id: 'default' as Target, label: t('Normal chat'), hint: t('A normal chat: the agent plans and makes the changes') },
    ...guidedModes.map((mode) => ({ id: mode.id as Target, label: t(mode.label), hint: t(mode.menu) })),
  ].filter((option) => option.id !== current.value),
);
const mode = ref<Target>(
  options.value.find((option) => option.id === props.initialMode)?.id ?? options.value[0].id,
);
/** Set when the mode was already picked (from the mode chip): the dialog only confirms it, no picker. */
const chosen = computed(() => options.value.find((option) => option.id === props.initialMode));
const context = ref('');
const busy = ref(false);
const modal = ref<HTMLElement>();

onMounted(async () => {
  await nextTick();
  // With a preselected mode (picked from the mode chip), focus the context field: the user is here to confirm.
  const focusTarget = props.initialMode
    ? modal.value?.querySelector<HTMLElement>('textarea')
    : modal.value?.querySelector<HTMLElement>('.hand-off-option');
  focusTarget?.focus();
});

function submit() {
  if (busy.value) return;
  busy.value = true;
  emit('handOff', { mode: mode.value, context: context.value.trim() });
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('cancel');
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    submit();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="modal-backdrop"
      @keydown="keydown"
      @click.self="emit('cancel')"
    >
      <section
        ref="modal"
        class="small-modal hand-off-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hand-off-title"
      >
        <header class="modal-header">
          <h2 id="hand-off-title">
            {{ t('Switch mode') }}
          </h2>
        </header>
        <p class="dialog-detail">
          {{
            t(
              'Switches this chat to the chosen mode and continues the conversation here.',
            )
          }}
        </p>
        <div
          v-if="chosen"
          class="hand-off-preview"
        >
          <img
            v-if="chosen.id === 'default'"
            class="chat-icon"
            :src="appIcon"
            alt=""
          >
          <ChatModeIcon
            v-else
            :mode="chosen.id as GuidedMode"
            :size="18"
          />
          <div>
            <strong>{{ chosen.label }}</strong>
            <span>{{ chosen.hint }}</span>
          </div>
        </div>
        <div
          v-else
          class="hand-off-options"
          role="radiogroup"
          :aria-label="t('Mode')"
        >
          <button
            v-for="option in options"
            :key="option.id"
            type="button"
            role="radio"
            class="hand-off-option"
            :class="{ selected: mode === option.id }"
            :aria-checked="mode === option.id"
            :title="option.hint"
            @click="mode = option.id"
            @dblclick="submit"
          >
            <img
              v-if="option.id === 'default'"
              class="chat-icon"
              :src="appIcon"
              alt=""
            >
            <ChatModeIcon
              v-else
              :mode="option.id as GuidedMode"
              :size="16"
            />
            <span>{{ option.label }}</span>
          </button>
        </div>
        <label class="hand-off-context">
          {{ t('Extra context for the hand-off (optional)') }}
          <textarea
            v-model="context"
            rows="4"
            maxlength="20000"
            :placeholder="t('For example: focus on the payment flow, the fix we found is in checkout.ts')"
          />
        </label>
        <footer class="modal-footer">
          <button
            type="button"
            class="secondary-button"
            @click="emit('cancel')"
          >
            {{ t('Cancel') }}
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="busy"
            @click="submit"
          >
            {{ t('Switch') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.hand-off-preview {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}
.hand-off-preview .chat-icon {
  width: 16px;
  height: 16px;
}
.hand-off-preview div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.hand-off-preview span {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.hand-off-modal {
  width: min(520px, calc(100vw - 32px));
}
.hand-off-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px;
  margin: 4px 0 12px;
}
.hand-off-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.hand-off-option:hover {
  background: var(--accent-soft);
}
.hand-off-option.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.hand-off-option .chat-icon {
  width: 16px;
  height: 16px;
}
.hand-off-context {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
}
.hand-off-context textarea {
  resize: vertical;
  font: inherit;
}
</style>
