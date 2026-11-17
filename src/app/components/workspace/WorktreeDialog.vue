<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Workspace } from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';
import FormDialog from '../common/FormDialog.vue';

const props = defineProps<{ workspace: Workspace }>();
const emit = defineEmits<{ close: []; created: [workspace: Workspace] }>();

const branch = ref('');
const base = ref('');
const busy = ref(false);
const error = ref('');
// Same rule as the server; it checks again.
const valid = computed(
  () =>
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch.value) &&
    !branch.value.includes('..') &&
    !/[/.]$/.test(branch.value) &&
    !branch.value.endsWith('.lock'),
);

async function create() {
  if (!valid.value) return;
  busy.value = true;
  error.value = '';
  try {
    const workspace = await rpc<Workspace>('worktree.create', {
      workspaceId: props.workspace.id,
      branch: branch.value,
      ...(base.value.trim() ? { base: base.value.trim() } : {}),
    });
    emit('created', workspace);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <FormDialog
    :title="t('New worktree')"
    @close="emit('close')"
    @submit="create"
  >
    <p class="muted">
      {{
        t(
          'A second checkout of {name} on its own branch. It opens as a separate workspace, so chats there run alongside this one without touching its files.',
          { name: workspace.name },
        )
      }}
    </p>
    <label>{{ t('New branch') }}
      <input
        v-model="branch"
        autocomplete="off"
        maxlength="100"
        placeholder="feature/my-change"
        autofocus
        :disabled="busy"
      >
    </label>
    <label>{{ t('Start from (optional)') }}
      <input
        v-model="base"
        autocomplete="off"
        maxlength="200"
        placeholder="HEAD"
        :disabled="busy"
      >
    </label>
    <p class="muted small">
      {{ t('It is created beside the repository, in a folder named after the repository with .worktrees added.') }}
    </p>
    <p
      v-if="error"
      class="error-box"
      role="alert"
    >
      {{ error }}
    </p>
    <template #footer>
      <button
        type="button"
        class="secondary-button"
        :disabled="busy"
        @click="emit('close')"
      >
        {{ t('Cancel') }}
      </button>
      <button
        type="submit"
        class="primary-button"
        :disabled="busy || !valid"
      >
        {{ busy ? t('Creating…') : t('Create worktree') }}
      </button>
    </template>
  </FormDialog>
</template>
