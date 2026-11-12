<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const text = ref('');
const tooltip = ref<HTMLElement>();
const position = ref({ left: '0px', top: '0px' });
// Wait briefly before showing, so tooltips don't flash while the pointer just passes over controls.
const SHOW_DELAY_MS = 450;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let currentTarget: HTMLElement | undefined;

function show(event: Event) {
  const target = (event.target as Element).closest<HTMLElement>('[title], [data-app-tooltip]');
  if (!target || target.tagName === 'IFRAME') {
    hide();
    return;
  }
  // Moving between children of the same target re-fires pointerover; keep the tooltip as is.
  if (target === currentTarget) return;
  hide();
  currentTarget = target;
  const title = target.getAttribute('title') ?? target.dataset.appTooltip ?? '';
  // Strip the native title right away so the browser's own tooltip never appears.
  target.dataset.appTooltip = title;
  target.removeAttribute('title');
  if (!target.getAttribute('aria-label') && !target.textContent?.trim())
    target.setAttribute('aria-label', title);
  showTimer = setTimeout(() => void place(target, title), SHOW_DELAY_MS);
}

async function place(target: HTMLElement, title: string) {
  text.value = title;
  const box = target.getBoundingClientRect();
  position.value = {
    left: `${Math.max(8, Math.min(box.left, window.innerWidth - 368))}px`,
    top: `${box.bottom + 8}px`,
  };
  // Measure the rendered tooltip so multi-line text is shown whole: below the target if it fits, else above.
  await nextTick();
  const height = tooltip.value?.offsetHeight ?? 0;
  if (box.bottom + 8 + height > window.innerHeight - 8)
    position.value = { ...position.value, top: `${Math.max(8, box.top - 8 - height)}px` };
}
function hide(event?: Event) {
  // Ignore pointerout into a child of the current target; the pointer is still over it.
  if (
    event instanceof PointerEvent &&
    event.type === 'pointerout' &&
    currentTarget &&
    event.relatedTarget instanceof Node &&
    currentTarget.contains(event.relatedTarget)
  )
    return;
  clearTimeout(showTimer);
  currentTarget = undefined;
  text.value = '';
}
onMounted(() => {
  document.addEventListener('pointerover', show);
  document.addEventListener('focusin', show);
  document.addEventListener('pointerout', hide);
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('keydown', hide);
  document.addEventListener('scroll', hide, true);
});
onBeforeUnmount(() => {
  clearTimeout(showTimer);
  document.removeEventListener('pointerover', show);
  document.removeEventListener('focusin', show);
  document.removeEventListener('pointerout', hide);
  document.removeEventListener('focusout', hide);
  document.removeEventListener('pointerdown', hide);
  document.removeEventListener('keydown', hide);
  document.removeEventListener('scroll', hide, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="text"
      ref="tooltip"
      class="app-tooltip"
      role="tooltip"
      :style="position"
    >
      {{ text }}
    </div>
  </Teleport>
</template>
