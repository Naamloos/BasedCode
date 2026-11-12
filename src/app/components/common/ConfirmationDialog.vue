<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { confirmation, decideConfirmation } from '../../state/dialogs';
import { t } from '../../theme/themes';

const modal = ref<HTMLElement>();
let previous: HTMLElement | null = null;
watch(
  confirmation,
  async (value, old) => {
    if (value) {
      if (!old) previous = document.activeElement as HTMLElement;
      await nextTick();
      modal.value?.querySelector<HTMLButtonElement>('button')?.focus();
    } else previous?.focus();
  },
  { immediate: true },
);
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    decideConfirmation(false);
  }
  if (event.key !== 'Tab') return;
  const buttons = [...modal.value!.querySelectorAll<HTMLButtonElement>('button')];
  if (event.shiftKey && document.activeElement === buttons[0]) {
    event.preventDefault();
    buttons.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
    event.preventDefault();
    buttons[0]?.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="confirmation"
      class="modal-backdrop confirmation-backdrop"
      @keydown="keydown"
      @click.self="decideConfirmation(false)"
    >
      <section
        ref="modal"
        class="small-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-detail"
      >
        <header class="modal-header">
          <h2 id="confirmation-title">
            {{ confirmation.title }}
          </h2>
        </header>
        <p
          id="confirmation-detail"
          class="dialog-detail"
        >
          {{ confirmation.detail }}
        </p>
        <footer class="modal-footer">
          <button
            type="button"
            class="secondary-button"
            @click="decideConfirmation(false)"
          >
            {{ t('Cancel') }}
          </button>
          <button
            type="button"
            class="primary-button"
            @click="decideConfirmation(true)"
          >
            {{ confirmation.accept }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
