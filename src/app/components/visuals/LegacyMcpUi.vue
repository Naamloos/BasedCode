<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { z } from 'zod';
import type { EmbeddedResource } from '@modelcontextprotocol/sdk/types.js';
import type { Message } from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/i18n';

const props = defineProps<{
  message: Message;
  workspaceId: string;
  resource: EmbeddedResource['resource'];
}>();
const host = ref<HTMLElement>();
const frame = ref<HTMLIFrameElement>();
const frameUrl = new URL('/mcp-ui.html', location.href).href;
const height = ref(360);
const error = ref('');
const notice = ref('');
let active = true;
let lastPrompt = 0;

const params = z.record(z.string(), z.unknown());
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tool'), payload: z.object({ toolName: z.string().min(1), params: params.default({}) }) }),
  z.object({ type: z.literal('prompt'), payload: z.object({ prompt: z.string().trim().min(1).max(20_000) }) }),
  z.object({ type: z.literal('intent'), payload: z.object({ intent: z.string().min(1).max(1000), params: params.default({}) }) }),
  z.object({ type: z.literal('link'), payload: z.object({ url: z.url() }) }),
  z.object({ type: z.literal('notify'), payload: z.object({ message: z.string().max(20_000) }) }),
]);

async function handleAction(input: unknown): Promise<unknown> {
  try {
    if (!active) throw new Error('This widget is no longer active.');
    // RemoteDOM also forwards its internal thread transport messages, including arrays.
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        !('type' in input) || !['tool', 'prompt', 'intent', 'link', 'notify'].includes(String(input.type))) return {};
    const action = actionSchema.parse(input);
    error.value = '';
    if (action.type === 'tool') {
      const tool = props.message.metadata.tool as { args: { serverId: string } };
      return await rpc('mcp.call', {
        messageId: props.message.id,
        workspaceId: props.workspaceId,
        serverId: tool.args.serverId,
        name: action.payload.toolName,
        arguments: action.payload.params,
      });
    }
    if (action.type === 'notify') {
      notice.value = action.payload.message;
      return {};
    }
    // Loading historical widgets must not submit prompts or open links without user interaction.
    if (!host.value?.contains(document.activeElement)) throw new Error('Interact with the widget before using this action.');
    if (action.type === 'link') return await rpc('external.open', { url: action.payload.url });
    if (Date.now() - lastPrompt < 1000) throw new Error('Wait before sending another widget prompt.');
    lastPrompt = Date.now();
    const prompt = action.type === 'prompt'
      ? action.payload.prompt
      : `${action.payload.intent}\n${JSON.stringify(action.payload.params)}`;
    return await rpc('run.submit', { chatId: props.message.chatId, prompt, attachmentIds: [] });
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
    throw failure;
  }
}

function sendRenderData() {
  const tool = props.message.metadata.tool as { args: { arguments?: unknown }; result?: { result?: unknown } };
  frame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify({
    type: 'basedcode-mcp-ui-render',
    resource: props.resource,
    renderData: {
      toolInput: tool.args.arguments ?? {},
      toolOutput: tool.result?.result,
      theme: document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark',
    },
  })), location.origin);
}
async function receive(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'basedcode-mcp-ui-ready') sendRenderData();
  if (data?.type === 'basedcode-mcp-ui-size' && typeof data.height === 'number' && Number.isFinite(data.height))
    height.value = Math.max(1, data.height);
  if (data?.type !== 'basedcode-mcp-ui-action' || typeof data.id !== 'string') return;
  const target = frame.value?.contentWindow;
  try {
    const result = await handleAction(data.action);
    target?.postMessage({ type: 'basedcode-mcp-ui-response', id: data.id, result }, location.origin);
  } catch (failure) {
    target?.postMessage({ type: 'basedcode-mcp-ui-response', id: data.id, error: String(failure) }, location.origin);
  }
}
const themeObserver = new MutationObserver(sendRenderData);

onMounted(() => {
  window.addEventListener('message', receive);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] });
});
onBeforeUnmount(() => {
  active = false;
  themeObserver.disconnect();
  window.removeEventListener('message', receive);
});
</script>

<template>
  <div class="mcp-app">
    <div class="eyebrow">
      {{ t('MCP-UI · ISOLATED VIEW') }}
    </div>
    <p
      v-if="error"
      class="error-text"
    >
      {{ error }}
    </p>
    <p
      v-if="notice"
      role="status"
    >
      {{ notice }}
    </p>
    <div ref="host">
      <iframe
        ref="frame"
        :src="frameUrl"
        :style="{ width: '100%', height: `${height}px`, border: '0' }"
        :title="t('Legacy MCP-UI widget')"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-downloads"
        referrerpolicy="no-referrer"
        @load="sendRenderData"
      />
    </div>
  </div>
</template>
