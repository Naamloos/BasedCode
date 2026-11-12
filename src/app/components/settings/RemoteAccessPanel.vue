<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Check, Copy, Globe, LoaderCircle, Square } from '../../icons';
import type { RemoteAccessStatus } from '../../../shared/types';
import { onEvent, rpc } from '../../services/api';
import { t } from '../../theme/themes';

const cloudflaredPath = defineModel<string | undefined>('cloudflaredPath');
const status = ref<RemoteAccessStatus>({ state: 'stopped' });
const busy = ref(false);
const copied = ref(false);

async function refresh() {
  status.value = await rpc<RemoteAccessStatus>('remote.status');
}
async function start() {
  busy.value = true;
  try {
    status.value = await rpc<RemoteAccessStatus>('remote.start', {
      cloudflaredPath: cloudflaredPath.value ?? '',
    });
  } catch (failure) {
    status.value = {
      state: 'error',
      error: failure instanceof Error ? failure.message : String(failure),
    };
  } finally {
    busy.value = false;
  }
}
async function stop() {
  status.value = await rpc<RemoteAccessStatus>('remote.stop');
}
async function copy() {
  if (!status.value.url) return;
  await navigator.clipboard.writeText(status.value.url);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1500);
}

let unsubscribe = () => {};
onMounted(() => {
  void refresh();
  unsubscribe = onEvent((event) => {
    if (event.type === 'remote') void refresh();
  });
});
onBeforeUnmount(() => unsubscribe());
</script>

<template>
  <h3><Globe :size="15" /> {{ t('Remote access') }}</h3>
  <p class="muted">
    {{
      t(
        'Opens BasedCode on another device, such as your phone, through a temporary Cloudflare tunnel. Anyone with the link has full control of BasedCode, including running commands, so share it only with yourself. Stopping the tunnel or restarting BasedCode makes the link stop working.',
      )
    }}
  </p>
  <div class="form-grid">
    <label class="full-width">{{ t('cloudflared executable')
    }}<input
      v-model="cloudflaredPath"
      autocomplete="off"
      placeholder="cloudflared"
      spellcheck="false"
    ></label>
  </div>
  <div class="row remote-actions">
    <button
      v-if="status.state === 'running'"
      class="secondary-button"
      @click="stop"
    >
      <Square :size="14" /> {{ t('Stop remote access') }}
    </button>
    <button
      v-else
      class="primary-button"
      :disabled="busy || status.state === 'starting'"
      @click="start"
    >
      <LoaderCircle
        v-if="busy || status.state === 'starting'"
        class="spin"
        :size="14"
      />
      <Globe
        v-else
        :size="14"
      />
      {{ busy || status.state === 'starting' ? t('Starting tunnel…') : t('Start remote access') }}
    </button>
  </div>
  <p
    v-if="status.state === 'error'"
    class="error-text"
  >
    {{ status.error }}
  </p>
  <div
    v-if="status.state === 'running' && status.url"
    class="remote-link"
  >
    <img
      v-if="status.qr"
      :src="status.qr"
      :alt="t('QR code for the remote access link')"
    >
    <div class="remote-url">
      <code>{{ status.url }}</code>
      <button
        class="secondary-button"
        @click="copy"
      >
        <Check
          v-if="copied"
          :size="14"
        />
        <Copy
          v-else
          :size="14"
        /> {{ copied ? t('Copied') : t('Copy link') }}
      </button>
      <p class="muted small">
        {{
          t('Scan the code with your phone, or open the link on any device. Local port {port}.', {
            port: String(status.port),
          })
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.remote-actions {
  margin: 12px 0;
}
.remote-link {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.remote-link img {
  width: 200px;
  height: 200px;
  background: #fff;
  padding: 8px;
  border-radius: var(--radius-sm);
}
.remote-url {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.remote-url code {
  word-break: break-all;
  user-select: all;
}
</style>
