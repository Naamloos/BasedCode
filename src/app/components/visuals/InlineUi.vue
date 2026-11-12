<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { Sparkles } from '../../icons';
import type { Message } from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';
import ZoomFrame from '../common/ZoomFrame.vue';

const props = defineProps<{ message: Message }>();
const tool = computed(() => props.message.metadata.tool as {
  name: string;
  args: { title?: string; question?: string };
  status: string;
  result?: { queryId?: string; answer?: unknown };
  error?: string;
});
const query = computed(() => tool.value.name.startsWith('query_'));
const submitting = ref(false);
function sendInactive() {
  if (query.value && (tool.value.status !== 'running' || submitting.value))
    frame.value?.contentWindow?.postMessage({ type: 'basedcode-ui-inactive' }, '*');
}
watch(() => tool.value.status, sendInactive);
const frame = ref<HTMLIFrameElement>();
const src = ref('');
const error = ref('');
const height = ref(160);
const sent = ref('');
/** Bundled libraries load before the frame's load event, so the frame stays hidden until then. */
const loaded = ref(false);
function onLoad() {
  loaded.value = true;
  sendTheme();
}
let lastPrompt = 0;
let themeObserver: MutationObserver | undefined;

/** Hands the app's current theme to the component so it matches light and dark appearances. */
function sendTheme() {
  sendInactive();
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  const tokens = {
    '--fg': token('--text'),
    '--muted': token('--muted'),
    '--accent': token('--accent'),
    '--border': token('--border-strong') || token('--border'),
    '--surface': token('--surface-raised'),
  };
  frame.value?.contentWindow?.postMessage(
    {
      type: 'basedcode-ui-theme',
      scheme: document.documentElement.dataset.scheme ?? 'dark',
      tokens,
    },
    '*',
  );
}

/** Only messages from this component's own frame count; prompts also need the user to have clicked into it. */
function receive(event: MessageEvent) {
  if (!frame.value || event.source !== frame.value.contentWindow) return;
  const data = event.data as { type?: string; action?: string; height?: unknown; text?: unknown; value?: unknown };
  if (data?.type !== 'basedcode-ui') return;
  if (data.action === 'size' && typeof data.height === 'number' && Number.isFinite(data.height))
    height.value = Math.max(60, data.height + 2);
  if (data.action === 'submit' && query.value && tool.value.status === 'running' && !submitting.value) {
    // Games and delayed callbacks can finish after focus has moved away from the frame.
    // The source check above and running-query check authenticate this result.
    submitting.value = true;
    rpc('query.answer', { messageId: props.message.id, value: data.value })
      .then(() => { error.value = ''; sendInactive(); })
      .catch((failure) => {
        submitting.value = false;
        error.value = failure instanceof Error ? failure.message : String(failure);
      });
  }
  if (!query.value && data.action === 'prompt' && typeof data.text === 'string' && data.text.trim()) {
    if (document.activeElement !== frame.value || Date.now() - lastPrompt < 1000) return;
    lastPrompt = Date.now();
    const text = data.text.trim();
    rpc('run.submit', { chatId: props.message.chatId, prompt: text, attachmentIds: [] })
      .then(() => {
        sent.value = text;
        error.value = '';
      })
      .catch((failure) => {
        error.value = failure instanceof Error ? failure.message : String(failure);
      });
  }
}
onMounted(async () => {
  addEventListener('message', receive);
  themeObserver = new MutationObserver(sendTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'data-theme', 'data-scheme'],
  });
  if (!query.value && tool.value.status !== 'completed') return;
  try {
    src.value = (await rpc<{ url: string }>('app.view', { messageId: props.message.id })).url;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
});
onBeforeUnmount(() => {
  removeEventListener('message', receive);
  themeObserver?.disconnect();
});
</script>

<template>
  <div class="inline-ui">
    <div class="eyebrow">
      <Sparkles :size="12" /> {{ tool.args.title ?? t('Component') }}
    </div>
    <p
      v-if="error || tool.error"
      class="error-text"
    >
      {{ error || tool.error }}
    </p>
    <p v-if="query && tool.status === 'completed'">
      Answered: {{ JSON.stringify(tool.result?.answer) }}
    </p>
    <p v-else-if="query && tool.status === 'failed'">
      Inactive
    </p>
    <ZoomFrame
      v-if="src"
      :title="tool.args.title ?? tool.args.question ?? t('Component')"
      :disabled="query"
      interactive
    >
      <iframe
        ref="frame"
        :inert="query && (tool.status !== 'running' || submitting)"
        :src="src"
        :style="{ height: `${height}px` }"
        :title="tool.args.title ?? tool.args.question ?? t('Component')"
        sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads"
        referrerpolicy="no-referrer"
        :class="{ 'inline-ui-loading': !loaded }"
        @load="onLoad"
      />
    </ZoomFrame>
    <p
      v-if="src && !loaded"
      class="inline-ui-sent"
    >
      {{ t('Loading…') }}
    </p>
    <p
      v-if="sent"
      class="inline-ui-sent"
    >
      {{ t('Queued: {prompt}', { prompt: sent }) }}
    </p>
  </div>
</template>

<style scoped>
.inline-ui {
  margin: 6px 0;
  display: grid;
  gap: 6px;
}
.inline-ui .eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.inline-ui iframe {
  display: block;
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--border, #3a3a3a);
  border-radius: 8px;
  background: transparent;
}
.inline-ui iframe.inline-ui-loading {
  visibility: hidden;
  height: 0 !important;
  border: 0;
}
.inline-ui-sent {
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
}
</style>
