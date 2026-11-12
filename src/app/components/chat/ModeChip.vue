<script setup lang="ts">
/**
 * The mode chip in the composer toolbar: shows the chat's mode and opens a menu to pick another one
 * or wrap up a guided session. The parent confirms and does the switching; this only collects choices.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Check, ChevronDown, FileText } from '../../icons';
import { guidedMode, guidedModes, type GuidedMode } from '../../../shared/chatModes';
import type { ChatMode } from '../../../shared/types';
import { t } from '../../theme/themes';
import ChatModeIcon from '../common/ChatModeIcon.vue';

type Target = Exclude<ChatMode, 'review'>;

const props = defineProps<{
  mode?: ChatMode;
  appIcon: string;
  /** The chat has messages: switching continues it with a note, and Wrap up is possible. */
  started: boolean;
  running: boolean;
  wrappedUp: boolean;
}>();
const emit = defineEmits<{
  switch: [mode: Target];
  wrapUp: [];
}>();

const open = ref(false);
const root = ref<HTMLElement>();
const chip = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();

const current = computed(() => guidedMode(props.mode));
const options = computed(() => [
  { id: 'default' as Target, label: t('Normal chat'), hint: t('A normal chat: the agent plans and makes the changes') },
  ...guidedModes.map((mode) => ({ id: mode.id as Target, label: t(mode.label), hint: t(mode.menu) })),
]);
const selectedId = computed(() => props.mode ?? 'default');
const title = computed(() =>
  props.running ? t('Wait for the prompt to finish before switching modes') : t('Switch this chat to another mode'),
);

function items(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>('[role="menuitemradio"],[role="menuitem"]') ?? [])];
}
async function show() {
  if (props.running) return;
  open.value = true;
  await nextTick();
  (items().find((item) => item.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
}
function close(refocus = true) {
  open.value = false;
  if (refocus) chip.value?.focus();
}
function pick(id: Target) {
  close();
  if (id !== selectedId.value) emit('switch', id);
}
function wrapUp() {
  close();
  emit('wrapUp');
}
function chipKeydown(event: KeyboardEvent) {
  if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    void show();
  }
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  const list = items();
  const index = list.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    list[(index + step + list.length) % list.length]?.focus();
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
  }
}
function outside(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close(false);
}
watch(open, (value) =>
  value ? document.addEventListener('pointerdown', outside) : document.removeEventListener('pointerdown', outside),
);
watch(
  () => props.running,
  (running) => running && open.value && close(false),
);
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div
    ref="root"
    class="mode-chip-root"
  >
    <button
      ref="chip"
      type="button"
      class="mode-chip"
      :class="{ guided: current }"
      :style="current ? { '--mode-color': current.color } : undefined"
      :disabled="running"
      :title="title"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open ? close() : show()"
      @keydown="chipKeydown"
    >
      <ChatModeIcon
        v-if="current"
        :mode="current.id"
        :size="13"
      />
      <span
        v-else
        class="mode-chip-dot"
        aria-hidden="true"
      />
      <span>{{ current ? t(current.label) : t('Normal') }}</span>
      <span
        v-if="wrappedUp"
        class="mode-chip-state"
      >· {{ t('Wrapped up') }}</span>
      <ChevronDown
        :size="12"
        aria-hidden="true"
      />
    </button>
    <Transition name="mode-menu">
      <div
        v-if="open"
        ref="menu"
        class="mode-menu"
        role="menu"
        :aria-label="t('Mode')"
        @keydown="menuKeydown"
      >
        <div class="mode-menu-list">
          <button
            v-for="option in options"
            :key="option.id"
            type="button"
            role="menuitemradio"
            class="mode-menu-item"
            :class="{ selected: option.id === selectedId }"
            :style="option.id !== 'default' ? { '--mode-color': guidedMode(option.id)?.color } : undefined"
            :aria-checked="option.id === selectedId"
            @click="pick(option.id)"
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
              :size="15"
            />
            <span class="mode-menu-text">
              <strong>{{ option.label }}</strong>
              <small>{{ option.hint }}</small>
            </span>
            <Check
              v-if="option.id === selectedId"
              :size="13"
              class="mode-menu-check"
            />
          </button>
        </div>
        <button
          v-if="current && started && !wrappedUp"
          type="button"
          role="menuitem"
          class="mode-menu-item mode-menu-wrap"
          :title="t('End the session: the agent posts a report here, then the chat is locked')"
          @click="wrapUp"
        >
          <FileText :size="14" /><span>{{ t('Wrap up session') }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mode-chip-root {
  position: relative;
}
.mode-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.mode-chip:hover:not(:disabled) {
  background: var(--surface-hover);
}
.mode-chip:disabled {
  opacity: 0.55;
  cursor: default;
}
.mode-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.mode-chip.guided {
  border-color: color-mix(in srgb, var(--mode-color) 35%, transparent);
  background: color-mix(in srgb, var(--mode-color) 14%, transparent);
  color: var(--mode-color);
}
.mode-chip.guided:hover:not(:disabled) {
  background: color-mix(in srgb, var(--mode-color) 22%, transparent);
}
.mode-chip-dot {
  width: 9px;
  height: 9px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
}
.mode-chip-state {
  opacity: 0.8;
}
.mode-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 300px;
  max-height: min(460px, 70vh);
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  box-shadow: var(--shadow-float);
}
.mode-menu-list {
  overflow-y: auto;
  padding: 4px 0;
}
.mode-menu-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.mode-menu-item:hover,
.mode-menu-item:focus-visible {
  background: var(--surface-hover);
  outline: none;
}
.mode-menu-item.selected {
  background: color-mix(in srgb, var(--mode-color, var(--accent)) 14%, transparent);
}
.mode-menu-item .chat-icon {
  width: 15px;
  height: 15px;
}
.mode-menu-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.mode-menu-text strong {
  font-size: 12.5px;
  font-weight: 600;
}
.mode-menu-text small {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.35;
}
.mode-menu-check {
  margin-top: 2px;
  color: var(--mode-color, var(--accent));
}
.mode-menu-wrap {
  align-items: center;
  margin-top: 2px;
  border-top: 1px solid var(--border);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  padding-top: 8px;
}
.mode-menu-enter-active,
.mode-menu-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}
.mode-menu-enter-from,
.mode-menu-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
@media (prefers-reduced-motion: reduce) {
  .mode-menu-enter-active,
  .mode-menu-leave-active {
    transition: none;
  }
}
</style>
