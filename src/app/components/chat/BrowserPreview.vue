<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { onEvent } from '../../services/api';

const props = defineProps<{ chatId?: string; workspaceId?: string }>();
const frame = ref<{ image: string; url: string; active: boolean }>();
const expanded = ref(true);
const unsubscribe = onEvent((event) => {
  if (event.type !== 'browser-preview' || event.workspaceId !== props.workspaceId) return;
  const data = event.data as { chatId: string; image?: string; url?: string; active: boolean };
  if (data.chatId !== props.chatId) return;
  if (data.image) frame.value = { image: data.image, url: data.url ?? '', active: data.active };
  else if (frame.value) frame.value.active = data.active;
});
watch(() => [props.chatId, props.workspaceId], () => { frame.value = undefined; });
onBeforeUnmount(unsubscribe);
</script>

<template>
  <section
    v-if="frame"
    class="live-browser"
  >
    <div class="live-browser-toolbar">
      <button
        class="live-browser-header"
        type="button"
        @click="expanded = !expanded"
      >
        <strong>{{ frame.active ? '● Live browser' : 'Browser session ended' }}</strong>
        <span>{{ frame.url }}</span>
        <span>{{ expanded ? 'Hide' : 'Show' }}</span>
      </button>
      <button
        v-if="!frame.active"
        class="live-browser-close"
        type="button"
        aria-label="Close browser preview"
        title="Close browser preview"
        @click="frame = undefined"
      >
        ×
      </button>
    </div>
    <img
      v-if="expanded"
      :src="'data:image/jpeg;base64,' + frame.image"
      alt="Agent browser live preview"
    >
  </section>
</template>

<style scoped>
.live-browser { box-sizing: border-box; width: calc(100% - 2 * clamp(12px, 4vw, 56px)); max-width: 760px; margin: 8px auto; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); }
.live-browser-toolbar { display: flex; align-items: center; }
.live-browser-close { border: 0; background: transparent; color: var(--text-secondary); padding: 8px 12px; cursor: pointer; font-size: 18px; }
.live-browser-header { display: flex; min-width: 0; flex: 1; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; border: 0; background: transparent; color: var(--text-secondary); text-align: left; font-size: 12px; }
.live-browser-header strong { white-space: nowrap; color: var(--text); }
.live-browser-header span:first-of-type { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-browser img { display: block; width: 100%; max-height: 340px; object-fit: contain; object-position: top; }
</style>
