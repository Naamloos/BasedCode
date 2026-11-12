<script setup lang="ts">
// Title-bar chip that appears when a newer installer is published on GitHub releases.
// Hidden entirely in source checkouts, where the backend reports the updater as unsupported.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Download, LoaderCircle } from '../../icons';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';

interface UpdateInfo {
  supported: boolean;
  current: string;
  latest?: string;
  available: boolean;
}

const info = ref<UpdateInfo>();
const installing = ref(false);
const failure = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

async function check() {
  try {
    info.value = await rpc<UpdateInfo>('update.check');
  } catch {
    /* Offline or rate-limited: try again on the next interval. */
  }
}

async function install() {
  if (installing.value) return;
  installing.value = true;
  failure.value = '';
  try {
    await rpc('update.install');
  } catch (error) {
    installing.value = false;
    failure.value = error instanceof Error ? error.message : String(error);
  }
}

onMounted(() => {
  void check();
  timer = setInterval(() => void check(), 6 * 60 * 60 * 1000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <button
    v-if="info?.supported && info.available"
    class="usage-chip update-chip"
    :disabled="installing"
    :title="
      failure ||
        t('BasedCode {latest} is available (you have {current}). Click to install and restart.', {
          latest: info.latest ?? '',
          current: info.current,
        })
    "
    @click="install"
  >
    <LoaderCircle
      v-if="installing"
      :size="13"
      class="spin"
    /><Download
      v-else
      :size="13"
    />
    <span>{{ installing ? t('Updating…') : t('Update') }}</span>
  </button>
</template>

<style scoped>
.update-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--accent, currentColor);
}
.spin {
  animation: update-spin 1s linear infinite;
}
@keyframes update-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
