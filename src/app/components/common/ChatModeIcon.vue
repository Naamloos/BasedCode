<script setup lang="ts">
/**
 * The icon for a guided chat mode: one Phosphor icon per mode. By default it is duotone in the mode's colour;
 * with `outline` it is the plain regular weight in the current text colour, for dense lists like the sidebar.
 */
import { computed, type Component } from 'vue';
import {
  PhBird,
  PhBookOpen,
  PhChalkboardTeacher,
  PhChatCircle,
  PhFire,
  PhLightning,
  PhMagnifyingGlass,
  PhMapTrifold,
  PhPaintBrush,
  PhScroll,
  PhSiren,
  PhSkull,
  PhTerminalWindow,
  PhTestTube,
  PhTruck,
  PhUsersThree,
  PhWrench,
} from '@phosphor-icons/vue';
import { guidedMode, type GuidedMode } from '../../../shared/chatModes';

const props = withDefaults(defineProps<{ mode: GuidedMode; size?: number; outline?: boolean }>(), {
  size: 16,
  outline: false,
});

const icons: Record<string, Component> = {
  archaeology: PhScroll,
  designer: PhPaintBrush,
  devil: PhSkull,
  docs: PhBookOpen,
  duck: PhBird,
  grill: PhFire,
  hackerman: PhTerminalWindow,
  incident: PhSiren,
  migration: PhTruck,
  pair: PhUsersThree,
  performance: PhLightning,
  planner: PhMapTrifold,
  refactor: PhWrench,
  reviewer: PhMagnifyingGlass,
  teacher: PhChalkboardTeacher,
  tests: PhTestTube,
};
const icon = computed(() => icons[props.mode] ?? PhChatCircle);
const color = computed(() => (props.outline ? undefined : guidedMode(props.mode)?.color));
</script>

<template>
  <component
    :is="icon"
    class="chat-mode-icon"
    :size="size"
    :weight="outline ? 'regular' : 'duotone'"
    :color="color"
    aria-hidden="true"
  />
</template>

<style scoped>
.chat-mode-icon {
  flex: none;
}
</style>
