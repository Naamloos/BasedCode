<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { browserStreamUrl, onEvent, rpc } from '../../services/api';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, X } from '../../icons';
import { t } from '../../theme/themes';

// A floating picture-in-picture card over the chat: watching the agent's browser shouldn't push the conversation up.
type Size = 'small' | 'large' | 'collapsed';
const sizeKey = 'basedcode.browserPreview.size';

const props = defineProps<{ chatId?: string; workspaceId?: string; busy?: boolean }>();
const frame = ref<{ url: string; active: boolean }>();
const size = ref<Size>(
  (['small', 'large', 'collapsed'] as const).find((value) => value === localStorage.getItem(sizeKey)) ?? 'small',
);
watch(size, (value) => localStorage.setItem(sizeKey, value));
const canvas = ref<HTMLCanvasElement>();
// Locally the card shows the live MJPEG stream; each browser session gets a fresh connection. Remote access, or a
// stream that fails, falls back to the throttled frames on the event stream.
const stream = ref<string>();
let session = 0;

// Fallback frames are decoded off the main thread and only the newest one waits, so a slow decode skips frames
// instead of queueing them up behind each other.
let latest: string | undefined;
let pending: string | undefined;
let drawing = false;
function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function draw(image: string) {
  pending = image;
  if (drawing) return;
  drawing = true;
  try {
    while (pending) {
      const next = pending;
      pending = undefined;
      const bitmap = await createImageBitmap(new Blob([decode(next)], { type: 'image/jpeg' }));
      const target = canvas.value;
      if (target) {
        if (target.width !== bitmap.width) target.width = bitmap.width;
        if (target.height !== bitmap.height) target.height = bitmap.height;
        target.getContext('2d')?.drawImage(bitmap, 0, 0);
      }
      bitmap.close();
    }
  } catch {
    // A truncated or corrupt frame: the next one replaces it.
  } finally {
    drawing = false;
  }
}

const unsubscribe = onEvent((event) => {
  if (event.type !== 'browser-preview' || event.workspaceId !== props.workspaceId) return;
  const data = event.data as { chatId: string; image?: string; url?: string; active: boolean };
  if (data.chatId !== props.chatId) return;
  if (data.image) {
    if (!frame.value?.active) stream.value = browserStreamUrl(data.chatId, ++session);
    latest = data.image;
    frame.value = { url: data.url ?? '', active: data.active };
    if (!stream.value && canvas.value) void draw(data.image);
  } else if (frame.value) frame.value.active = data.active;
});
// A freshly mounted canvas (first frame, or expanded again) starts blank: paint the newest frame into it.
watch(canvas, (element) => {
  if (element && latest) void draw(latest);
});
watch(
  () => [props.chatId, props.workspaceId],
  () => {
    frame.value = undefined;
    latest = undefined;
    stream.value = undefined;
  },
);
onBeforeUnmount(unsubscribe);

function streamFailed() {
  // Only a live session falls back; a finished stream just keeps showing its last frame.
  if (frame.value?.active) stream.value = undefined;
}
async function close() {
  if (props.busy) return;
  if (props.chatId) await rpc('browser.close', { chatId: props.chatId });
  frame.value = undefined;
  latest = undefined;
  stream.value = undefined;
}
</script>

<template>
  <section
    v-if="frame"
    class="live-browser"
    :class="size"
    :aria-label="t('Agent browser')"
  >
    <header class="live-browser-header">
      <span
        class="status-dot"
        :class="{ live: frame.active }"
      />
      <strong>{{ frame.active ? t('Live browser') : t('Browser session ended') }}</strong>
      <span
        class="live-browser-url"
        :title="frame.url"
      >{{ frame.url }}</span>
      <button
        v-if="size !== 'collapsed'"
        type="button"
        class="icon-button"
        :title="t(size === 'large' ? 'Smaller preview' : 'Larger preview')"
        :aria-label="t(size === 'large' ? 'Smaller preview' : 'Larger preview')"
        @click="size = size === 'large' ? 'small' : 'large'"
      >
        <component
          :is="size === 'large' ? Minimize2 : Maximize2"
          :size="13"
        />
      </button>
      <button
        type="button"
        class="icon-button"
        :title="t(size === 'collapsed' ? 'Show preview' : 'Hide preview')"
        :aria-label="t(size === 'collapsed' ? 'Show preview' : 'Hide preview')"
        :aria-expanded="size !== 'collapsed'"
        @click="size = size === 'collapsed' ? 'small' : 'collapsed'"
      >
        <component
          :is="size === 'collapsed' ? ChevronDown : ChevronUp"
          :size="13"
        />
      </button>
      <button
        type="button"
        class="icon-button"
        :disabled="busy"
        :title="t('Close browser preview')"
        :aria-label="t('Close browser preview')"
        @click="close"
      >
        <X :size="13" />
      </button>
    </header>
    <template v-if="size !== 'collapsed'">
      <img
        v-if="stream"
        :key="stream"
        class="live-browser-view"
        :src="stream"
        :alt="t('Agent browser live preview')"
        :title="t(size === 'large' ? 'Smaller preview' : 'Larger preview')"
        @error="streamFailed"
        @click="size = size === 'large' ? 'small' : 'large'"
      >
      <canvas
        v-else
        ref="canvas"
        class="live-browser-view"
        role="img"
        :aria-label="t('Agent browser live preview')"
        :title="t(size === 'large' ? 'Smaller preview' : 'Larger preview')"
        @click="size = size === 'large' ? 'small' : 'large'"
      />
    </template>
  </section>
</template>

<style scoped>
.live-browser {
  position: absolute;
  top: 52px;
  inset-inline-end: 20px;
  z-index: 15;
  box-sizing: border-box;
  width: 340px;
  max-width: calc(100% - 40px);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface, var(--bg));
  box-shadow: var(--shadow-float);
}
.live-browser.large {
  width: min(760px, calc(100% - 40px));
}
.live-browser.collapsed {
  width: 260px;
}
.live-browser-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px 4px 4px 10px;
  color: var(--text-secondary);
  font-size: 12px;
}
.live-browser-header strong {
  white-space: nowrap;
  color: var(--text);
}
.live-browser-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-browser-view {
  display: block;
  width: 100%;
  height: auto;
  max-height: 60vh;
  object-fit: contain;
  object-position: top;
  border-top: 1px solid var(--border);
  cursor: zoom-in;
}
.live-browser.large .live-browser-view {
  cursor: zoom-out;
}
</style>
