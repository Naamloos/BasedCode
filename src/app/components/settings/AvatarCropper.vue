<script setup lang="ts">
import { computed, ref } from 'vue';
import { t } from '../../theme/themes';

const props = defineProps<{ source: string }>();
const emit = defineEmits<{ done: [dataUrl: string]; cancel: [] }>();

const view = 240;
const output = 256;
const image = ref<HTMLImageElement>();
const zoom = ref(1);
const x = ref(0);
const y = ref(0);

const baseScale = computed(() =>
  image.value ? view / Math.min(image.value.naturalWidth, image.value.naturalHeight) : 1,
);
const scale = computed(() => baseScale.value * zoom.value);

function clamp() {
  if (!image.value) return;
  const width = image.value.naturalWidth * scale.value;
  const height = image.value.naturalHeight * scale.value;
  x.value = Math.min(0, Math.max(view - width, x.value));
  y.value = Math.min(0, Math.max(view - height, y.value));
}

function loaded(event: Event) {
  image.value = event.target as HTMLImageElement;
  zoom.value = 1;
  x.value = (view - image.value.naturalWidth * baseScale.value) / 2;
  y.value = (view - image.value.naturalHeight * baseScale.value) / 2;
}

function setZoom(value: number) {
  // Zoom around the center of the crop circle.
  const center = view / 2;
  const before = scale.value;
  zoom.value = value;
  x.value = center - ((center - x.value) * scale.value) / before;
  y.value = center - ((center - y.value) * scale.value) / before;
  clamp();
}

let drag: { pointerX: number; pointerY: number; x: number; y: number } | undefined;
function pointerDown(event: PointerEvent) {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = { pointerX: event.clientX, pointerY: event.clientY, x: x.value, y: y.value };
}
function pointerMove(event: PointerEvent) {
  if (!drag) return;
  x.value = drag.x + event.clientX - drag.pointerX;
  y.value = drag.y + event.clientY - drag.pointerY;
  clamp();
}
function wheel(event: WheelEvent) {
  setZoom(Math.min(4, Math.max(1, zoom.value - event.deltaY * 0.002)));
}

function apply() {
  if (!image.value) return;
  const canvas = document.createElement('canvas');
  canvas.width = output;
  canvas.height = output;
  canvas
    .getContext('2d')!
    .drawImage(
      image.value,
      -x.value / scale.value,
      -y.value / scale.value,
      view / scale.value,
      view / scale.value,
      0,
      0,
      output,
      output,
    );
  emit('done', canvas.toDataURL('image/jpeg', 0.9));
}
</script>

<template>
  <div class="avatar-cropper">
    <div
      class="crop-area"
      :style="{ width: `${view}px`, height: `${view}px` }"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="drag = undefined"
      @pointercancel="drag = undefined"
      @wheel.prevent="wheel"
    >
      <img
        :src="props.source"
        alt=""
        draggable="false"
        :style="{
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
          visibility: image ? 'visible' : 'hidden',
        }"
        @load="loaded"
      >
      <div class="crop-mask" />
    </div>
    <label>{{ t('Zoom') }}
      <input
        type="range"
        min="1"
        max="4"
        step="0.01"
        :value="zoom"
        @input="setZoom(Number(($event.target as HTMLInputElement).value))"
      >
    </label>
    <div class="crop-actions">
      <button
        class="secondary-button"
        @click="emit('cancel')"
      >
        {{ t('Cancel') }}
      </button>
      <button
        class="primary-button"
        :disabled="!image"
        @click="apply"
      >
        {{ t('Use avatar') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.avatar-cropper {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: fit-content;
}
.crop-area {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: var(--surface-2, #222);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.crop-area:active {
  cursor: grabbing;
}
.crop-area img {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  max-width: none;
  pointer-events: none;
}
.crop-mask {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 999px rgb(0 0 0 / 55%);
  outline: 2px solid rgb(255 255 255 / 70%);
  pointer-events: none;
}
.crop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
