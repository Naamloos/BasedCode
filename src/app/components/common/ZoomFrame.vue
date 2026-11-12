<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { Maximize2, Minus, Plus, RotateCcw, X } from '../../icons';
import { t } from '../../theme/themes';

/**
 * Wraps an in-chat visual so it can open full-window with wheel zoom and drag panning. The same slot content
 * moves into the overlay (Teleport) rather than rendering twice, so iframes and drawn diagrams are not duplicated.
 */
const props = defineProps<{ title: string; interactive?: boolean; disabled?: boolean }>();
const open = ref(false);
const viewport = ref<HTMLElement>();
const stage = ref<HTMLElement>();
const scale = ref(1);
const x = ref(0);
const y = ref(0);
let drag: { id: number; x: number; y: number } | undefined;

/** Scales the content to fit the window and centres it. */
function fit() {
  const area = viewport.value?.getBoundingClientRect();
  const content = stage.value;
  if (!area || !content) return;
  if (props.interactive) {
    scale.value = 1;
    x.value = 0;
    y.value = 0;
    return;
  }
  const width = content.offsetWidth || 1;
  const height = content.offsetHeight || 1;
  scale.value = Math.min((area.width - 48) / width, (area.height - 48) / height, 4);
  x.value = (area.width - width * scale.value) / 2;
  y.value = (area.height - height * scale.value) / 2;
}
/** Zooms by `factor` keeping the point (px, py) in the viewport fixed; defaults to the centre. */
function zoom(factor: number, px?: number, py?: number) {
  const area = viewport.value?.getBoundingClientRect();
  if (!area) return;
  const cx = px ?? area.width / 2;
  const cy = py ?? area.height / 2;
  const next = Math.min(12, Math.max(0.1, scale.value * factor));
  x.value = cx - ((cx - x.value) * next) / scale.value;
  y.value = cy - ((cy - y.value) * next) / scale.value;
  scale.value = next;
}
function wheel(event: WheelEvent) {
  const area = viewport.value!.getBoundingClientRect();
  zoom(Math.exp(-event.deltaY * 0.0015), event.clientX - area.left, event.clientY - area.top);
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  // Dragging pans; without this the browser starts a text or image selection instead.
  event.preventDefault();
  drag = { id: event.pointerId, x: event.clientX - x.value, y: event.clientY - y.value };
  viewport.value?.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return;
  x.value = event.clientX - drag.x;
  y.value = event.clientY - drag.y;
}
function up(event: PointerEvent) {
  if (drag?.id === event.pointerId) drag = undefined;
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') close();
  else if (props.interactive) return;
  else if (event.key === '+' || event.key === '=') zoom(1.25);
  else if (event.key === '-') zoom(0.8);
  else if (event.key === '0') fit();
}
async function show() {
  if (props.disabled) return;
  open.value = true;
  addEventListener('keydown', key);
  await nextTick();
  // Give images and iframes a moment to take their size before fitting.
  requestAnimationFrame(fit);
  setTimeout(fit, 250);
}
function close() {
  open.value = false;
  removeEventListener('keydown', key);
  scale.value = 1;
  x.value = 0;
  y.value = 0;
}
onBeforeUnmount(() => removeEventListener('keydown', key));
</script>

<template>
  <div class="zoom-frame">
    <button
      v-if="!open && !disabled"
      class="icon-button zoom-expand"
      :title="t('Open in a larger view')"
      :aria-label="t('Open in a larger view')"
      @click="show"
    >
      <Maximize2 :size="14" />
    </button>
    <div
      v-if="open"
      class="zoom-placeholder"
    >
      {{ t('Open in a larger view') }}
    </div>
    <Teleport
      to="body"
      :disabled="!open"
    >
      <div
        :class="open ? 'zoom-overlay' : 'zoom-inline'"
        :role="open ? 'dialog' : undefined"
        :aria-label="open ? title : undefined"
      >
        <header
          v-if="open"
          class="zoom-toolbar"
        >
          <strong>{{ title }}</strong><span class="spacer" /><template v-if="!interactive">
            <span class="zoom-level">{{ Math.round(scale * 100) }}%</span><button
              class="icon-button"
              :title="t('Zoom out (-)')"
              @click="zoom(0.8)"
            >
              <Minus :size="15" />
            </button><button
              class="icon-button"
              :title="t('Zoom in (+)')"
              @click="zoom(1.25)"
            >
              <Plus :size="15" />
            </button><button
              class="icon-button"
              :title="t('Fit to window (0)')"
              @click="fit"
            >
              <RotateCcw :size="15" />
            </button>
          </template><button
            class="icon-button"
            :title="t('Close (Esc)')"
            @click="close"
          >
            <X :size="16" />
          </button>
        </header>
        <div
          ref="viewport"
          :class="{ 'zoom-viewport': open, 'zoom-interactive': open && interactive }"
          @wheel="open && !interactive && ($event.preventDefault(), wheel($event))"
          @pointerdown="open && !interactive && down($event)"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
          @dblclick="open && !interactive && fit()"
        >
          <div
            ref="stage"
            :class="{ 'zoom-stage': open }"
            :style="open ? { transform: `translate(${x}px, ${y}px) scale(${scale})` } : undefined"
          >
            <slot />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.zoom-frame {
  position: relative;
}
.zoom-expand {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  background: var(--surface-raised);
  opacity: 0.75;
}
.zoom-frame:hover .zoom-expand,
.zoom-expand:focus-visible {
  opacity: 1;
}
.zoom-placeholder {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.zoom-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.zoom-toolbar .spacer {
  flex: 1;
}
.zoom-level {
  min-width: 48px;
  text-align: right;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  margin-right: 6px;
}
.zoom-viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-drag: none;
}
.zoom-viewport :deep(img) {
  -webkit-user-drag: none;
}
.zoom-viewport:active {
  cursor: grabbing;
}
.zoom-stage {
  position: absolute;
  top: 0;
  left: 0;
  width: min(1200px, 92vw);
  transform-origin: 0 0;
}
/* Inline size caps would fight the zoom; let the content take its natural size in the overlay. */
.zoom-stage :deep(img) {
  max-height: none;
  max-width: 100%;
  display: block;
}
.zoom-stage :deep(.chart-svg),
.zoom-stage :deep(.diagram-svg svg) {
  max-height: none;
}
.zoom-stage :deep(iframe) {
  pointer-events: auto;
}
.zoom-interactive {
  min-height: 0;
  cursor: auto;
  touch-action: auto;
  user-select: auto;
}
.zoom-interactive .zoom-stage {
  position: relative;
  width: 100%;
  height: 100%;
}
.zoom-interactive :deep(iframe) {
  display: block;
  width: 100%;
  height: 100% !important;
  border: 0;
  border-radius: 0;
}
</style>
