import { ref } from 'vue';
import { rpc } from '../services/api';

export interface UpdateInfo {
  supported: boolean;
  current: string;
  latest?: string;
  available: boolean;
}

export const updateInfo = ref<UpdateInfo>();
export const updating = ref(false);
export const updateFailure = ref('');
export const updateProgress = ref({ phase: 'idle', downloaded: 0, total: 0 });
export const updateDialog = ref(false);

export async function checkUpdate() {
  updateInfo.value = await rpc<UpdateInfo>('update.check');
  if (updateInfo.value.supported && updateInfo.value.available) updateDialog.value = true;
}

export async function installUpdate() {
  if (updating.value) return;
  updating.value = true;
  updateDialog.value = true;
  updateFailure.value = '';
  updateProgress.value = { phase: 'downloading', downloaded: 0, total: 0 };
  let polling = false;
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    void rpc<typeof updateProgress.value>('update.status')
      .then((status) => { updateProgress.value = status; })
      .catch(() => {})
      .finally(() => { polling = false; });
  }, 500);
  try {
    await rpc('update.install');
    updateProgress.value.phase = 'installing';
  } catch (error) {
    updating.value = false;
    updateFailure.value = error instanceof Error ? error.message : String(error);
  } finally {
    clearInterval(timer);
  }
}
