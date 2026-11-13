<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { Download } from '../../icons';
import { t } from '../../theme/themes';
import {
  checkUpdate, installUpdate, updateInfo as info, updating,
  updateFailure as failure, updateProgress as progress, updateDialog as visible,
} from '../../state/updates';

const dialog = ref<HTMLDialogElement>();
let timer: ReturnType<typeof setInterval> | undefined;

watchEffect(() => {
  if (visible.value && !dialog.value?.open) dialog.value?.showModal();
  else if (!visible.value && dialog.value?.open) dialog.value.close();
});

onMounted(() => {
  void checkUpdate().catch(() => {});
  timer = setInterval(() => void checkUpdate().catch(() => {}), 6 * 60 * 60 * 1000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <button
    v-if="info?.supported && info.available"
    class="usage-chip update-chip"
    @click="visible = true"
  >
    <Download :size="13" />
    <span>{{ updating ? t('Updating…') : t('Update') }}</span>
  </button>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="small-modal update-dialog"
      aria-labelledby="update-title"
      :closedby="updating ? 'none' : 'closerequest'"
      @cancel="updating ? $event.preventDefault() : (visible = false)"
      @close="visible = false"
    >
      <h2 id="update-title">{{ updating ? t('Updating…') : t('Update available') }}</h2>
      <p v-if="!updating">{{ t('Version {version} is available.', { version: info?.latest ?? '' }) }}</p>
      <div v-else>
        <p>{{ progress.phase === 'installing' ? t('Installing update and restarting…') : t('Downloading update…') }}</p>
        <progress
          :value="progress.total > 0 ? progress.downloaded : undefined"
          :max="progress.total || 1"
          :aria-label="t('Download progress')"
        />
        <p v-if="progress.total > 0" role="status">
          {{ Math.min(100, Math.floor(progress.downloaded / progress.total * 100)) }}%
          · {{ (progress.downloaded / 1024 / 1024).toFixed(1) }} / {{ (progress.total / 1024 / 1024).toFixed(1) }} MB
        </p>
      </div>
      <p v-if="failure" role="alert">{{ failure }}</p>
      <footer v-if="!updating" class="modal-footer">
        <button class="secondary-button" autofocus @click="visible = false">{{ t('Later') }}</button>
        <button class="primary-button" @click="installUpdate">{{ t('Install update and restart') }}</button>
      </footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.update-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--accent, currentColor);
}
.update-dialog {
  margin: auto;
  color: var(--text);
}
.update-dialog:modal {
  overscroll-behavior: contain;
}
.update-dialog::backdrop {
  background: var(--scrim);
  overflow: hidden;
  overscroll-behavior: contain;
}
.update-dialog progress {
  width: 100%;
  margin-top: 12px;
  accent-color: var(--accent);
}
</style>