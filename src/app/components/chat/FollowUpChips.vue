<script lang="ts">
let instances = 0;
</script>

<script setup lang="ts">
/**
 * Follow-up prompts the model proposed (suggest_prompts), as chips under its answer. "send" chips are filled and
 * send on click; "draft" chips are outlined and open the prompt in the composer. The parent does both.
 */
import { onBeforeUnmount, ref } from 'vue';
import { CornerDownLeft, Pencil } from '../../icons';
import { effectsActive } from '../../theme/effects';
import { t } from '../../theme/themes';
import type { FollowUp } from '../../state/followUps';

defineProps<{ suggestions: FollowUp[] }>();
const emit = defineEmits<{ choose: [suggestion: FollowUp] }>();

const id = `follow-up-${++instances}`;
const animate = effectsActive();
const tip = ref<{ index: number; above: boolean }>();
let timer = 0;

function show(index: number, target: EventTarget | null) {
  clearTimeout(timer);
  const box = (target as HTMLElement | null)?.getBoundingClientRect();
  tip.value = { index, above: Boolean(box && innerHeight - box.bottom < 180 && box.top > 180) };
}
function hover(index: number, event: PointerEvent) {
  clearTimeout(timer);
  const target = event.currentTarget;
  timer = window.setTimeout(() => show(index, target), 300);
}
function focus(index: number, event: FocusEvent) {
  if ((event.currentTarget as HTMLElement).matches(':focus-visible')) show(index, event.currentTarget);
}
function hide() {
  clearTimeout(timer);
  tip.value = undefined;
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div
    class="follow-ups"
    :class="{ animate }"
    role="group"
    :aria-label="t('Suggested follow-ups')"
  >
    <span
      v-for="(suggestion, index) in suggestions"
      :key="index"
      class="follow-up-wrap"
      :style="{ '--i': index }"
    >
      <button
        type="button"
        class="follow-up"
        :class="suggestion.action"
        :aria-describedby="`${id}-${index}`"
        @click="hide(); emit('choose', suggestion)"
        @pointerenter="hover(index, $event)"
        @pointerleave="hide"
        @focus="focus(index, $event)"
        @blur="hide"
        @keydown.esc="hide"
      >
        <CornerDownLeft
          v-if="suggestion.action === 'send'"
          :size="14"
          aria-hidden="true"
        />
        <Pencil
          v-else
          :size="14"
          aria-hidden="true"
        />
        <span class="follow-up-label">{{ suggestion.label }}</span>
      </button>
      <span
        :id="`${id}-${index}`"
        class="follow-up-description"
      >{{ suggestion.action === 'send' ? t('Sends now') : t('Opens in composer') }}: {{ suggestion.prompt }}</span>
      <span
        v-if="tip?.index === index"
        class="follow-up-tip"
        :class="{ above: tip.above }"
        aria-hidden="true"
      >
        <strong>{{ suggestion.action === 'send' ? t('Sends now') : t('Opens in composer') }}</strong>
        <span>{{ suggestion.prompt }}</span>
      </span>
    </span>
  </div>
</template>

<style scoped>
.follow-ups {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.follow-up-wrap {
  position: relative;
  max-width: 100%;
}
.animate .follow-up-wrap {
  animation: follow-up-in 180ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  animation-delay: calc(var(--i) * 40ms);
}
@keyframes follow-up-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .animate .follow-up-wrap {
    animation: none;
  }
}
.follow-up {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-height: 28px;
  padding: 4px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  color: var(--text);
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
}
@media (pointer: coarse) {
  .follow-up {
    min-height: 32px;
  }
}
.follow-up:hover {
  background: var(--surface-hover);
  border-color: var(--accent-line);
}
.follow-up:active {
  background: var(--surface-active);
}
.follow-up.send {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.follow-up.send:hover {
  border-color: var(--accent-hover);
  background: var(--accent-hover);
}
.follow-up.send:active {
  border-color: var(--accent-hi);
  background: var(--accent-hi);
}
.follow-up :deep(.icon) {
  flex: none;
}
.follow-up-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.follow-up-description {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.follow-up-tip {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: max-content;
  max-width: min(320px, 80vw);
  padding: 7px 9px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
  pointer-events: none;
}
.follow-up-tip.above {
  top: auto;
  bottom: calc(100% + 6px);
}
.follow-up-tip strong {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}
.follow-up-tip > span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
