<script setup lang="ts">
/**
 * The big mode icon on an empty chat. When the chat can still change mode, arrows on either side step to the
 * previous/next mode, and clicking the icon opens the same two-column chat-type list as the New chat menu.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { ChevronLeft, ChevronRight } from '../../icons';
import ChatModeIcon from '../common/ChatModeIcon.vue';
import { guidedMode, guidedModes, type GuidedMode } from '../../../shared/chatModes';
import { t } from '../../theme/themes';

const props = defineProps<{
  /** The chat's mode; 'default' (or absent) is the regular chat. */
  mode?: string;
  appIcon: string;
  /** False once the chat has started: then only the icon shows. */
  switchable: boolean;
}>();
const emit = defineEmits<{ select: [mode: string] }>();

/** Regular chat first, then the guided modes in menu order. Arrows wrap around. */
const order = computed(() => ['default', ...guidedModes.map((mode) => mode.id)]);
const current = computed(() => (props.mode && guidedMode(props.mode) ? props.mode : 'default'));
const currentLabel = computed(() =>
  current.value === 'default' ? t('Regular chat') : t(guidedMode(current.value)!.title),
);
function step(offset: number) {
  const list = order.value;
  const index = list.indexOf(current.value);
  emit('select', list[(index + offset + list.length) % list.length]);
}

const open = ref(false);
const root = ref<HTMLElement>();
const rows = Math.ceil((guidedModes.length + 1) / 2);
function toggle(event: MouseEvent) {
  open.value = !open.value;
  if (open.value && event.detail === 0)
    void nextTick(() => root.value?.querySelector<HTMLButtonElement>('.mode-picker button')?.focus());
}
function choose(mode: string) {
  open.value = false;
  emit('select', mode);
}
function outside(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) open.value = false;
}
document.addEventListener('pointerdown', outside);
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div
    ref="root"
    class="mode-switcher"
    @keydown.esc="open = false"
  >
    <button
      v-if="switchable"
      type="button"
      class="icon-button mode-step"
      :aria-label="t('Previous mode')"
      :title="t('Previous mode')"
      @click="step(-1)"
    >
      <ChevronLeft
        :size="18"
        class="icon-directional"
      />
    </button>
    <button
      v-if="switchable"
      type="button"
      class="mode-current"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="t('Chat mode: {mode}. Change mode', { mode: currentLabel })"
      :title="t('Change mode')"
      @click="toggle"
    >
      <ChatModeIcon
        v-if="current !== 'default'"
        :mode="current as GuidedMode"
        :size="56"
      />
      <img
        v-else
        :src="appIcon"
        alt=""
        class="welcome-icon"
      >
    </button>
    <template v-else>
      <ChatModeIcon
        v-if="current !== 'default'"
        :mode="current as GuidedMode"
        :size="56"
        class="welcome-icon"
      />
      <img
        v-else
        :src="appIcon"
        alt=""
        class="welcome-icon"
      >
    </template>
    <button
      v-if="switchable"
      type="button"
      class="icon-button mode-step"
      :aria-label="t('Next mode')"
      :title="t('Next mode')"
      @click="step(1)"
    >
      <ChevronRight
        :size="18"
        class="icon-directional"
      />
    </button>

    <div
      v-if="open"
      class="mode-picker new-chat-menu"
      role="menu"
      :aria-label="t('Chat mode')"
      :style="{ '--rows': rows }"
    >
      <button
        role="menuitem"
        :class="{ selected: current === 'default' }"
        :title="t('A normal chat: the agent plans and makes the changes')"
        @click="choose('default')"
      >
        <img
          class="chat-icon"
          :src="appIcon"
          alt=""
        ><span>{{ t('Regular chat') }}</span>
      </button>
      <button
        v-for="item in guidedModes"
        :key="item.id"
        role="menuitem"
        :class="{ selected: current === item.id }"
        :title="t(item.menu)"
        @click="choose(item.id)"
      >
        <ChatModeIcon
          :mode="item.id"
          :size="15"
        /><span>{{ t(item.title) }}</span>
      </button>
    </div>
  </div>
</template>
