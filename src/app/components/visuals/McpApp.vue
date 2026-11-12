<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { rpc } from '../../services/api';
import { t } from '../../theme/i18n';

const props = defineProps<{
  messageId: string;
  workspaceId: string;
  serverId: string;
  args: Record<string, unknown>;
  result: CallToolResult;
}>();
const frame = ref<HTMLIFrameElement>();
const src = ref('');
const error = ref('');
const height = ref(360);
let bridge: AppBridge | undefined;
const currentTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark';
const themeObserver = new MutationObserver(() => {
  bridge?.setHostContext({ theme: currentTheme(), displayMode: 'inline' });
});
// Vue props are reactive Proxies, which structured clone (postMessage) rejects.
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}
onMounted(async () => {
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] });
  try {
    src.value = (await rpc<{ url: string }>('app.view', { messageId: props.messageId })).url;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
});
async function loaded() {
  const content = frame.value?.contentWindow;
  if (!content) return;
  bridge = new AppBridge(
    null,
    { name: 'BasedCode', version: '0.1.0' },
    { serverTools: {} },
    { hostContext: { theme: currentTheme(), displayMode: 'inline' } },
  );
  bridge.oncalltool = async (request) =>
    plain(
      await rpc<CallToolResult>('mcp.call', {
        messageId: props.messageId,
        workspaceId: props.workspaceId,
        serverId: props.serverId,
        name: request.name,
        arguments: plain(request.arguments ?? {}),
      }),
    );
  bridge.onsizechange = (size) => {
    if (typeof size.height === 'number' && Number.isFinite(size.height))
      height.value = Math.max(1, size.height);
  };
  bridge.oninitialized = () => {
    void (async () => {
      await bridge?.sendToolInput({ arguments: plain(props.args) });
      await bridge?.sendToolResult(plain(props.result));
    })().catch((failure) => {
      error.value = String(failure);
    });
  };
  try {
    await bridge.connect(new PostMessageTransport(content, content));
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
}
onBeforeUnmount(() => {
  themeObserver.disconnect();
  void bridge?.close();
});
</script>

<template>
  <div class="mcp-app">
    <div class="eyebrow">
      {{ t('MCP APP · ISOLATED VIEW') }}
    </div>
    <p
      v-if="error"
      class="error-text"
    >
      {{ error }}
    </p>
    <iframe
      v-if="src"
      ref="frame"
      :src="src"
      :style="{ height: `${height}px` }"
      :title="t('MCP tool interface')"
      sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads"
      referrerpolicy="no-referrer"
      @load="loaded"
    />
  </div>
</template>
