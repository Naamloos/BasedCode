<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from '../../icons';
import { t } from '../../theme/themes';

// A modal form above the settings panel and below confirmations, so a "discard changes?" prompt stays visible.
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: []; submit: [] }>();
const panel = ref<HTMLElement>();
const previousFocus = document.activeElement as HTMLElement | null;
const titleId = `form-dialog-${Math.random().toString(36).slice(2)}`;
onMounted(async () => {
  await nextTick();
  (panel.value?.querySelector<HTMLElement>('[autofocus], input:not([disabled]), textarea, select, button.primary-button') ?? panel.value)?.focus();
});
onBeforeUnmount(() => previousFocus?.focus());
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div
      class="modal-backdrop form-dialog-backdrop"
      @keydown="keydown"
      @click.self="emit('close')"
    >
      <section
        ref="panel"
        class="small-modal form-dialog"
        :class="{ wide }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <form @submit.prevent="emit('submit')">
          <header class="modal-header">
            <h2 :id="titleId">
              {{ title }}
            </h2>
            <button
              type="button"
              class="icon-button"
              :aria-label="t('Close')"
              @click="emit('close')"
            >
              <X :size="18" />
            </button>
          </header>
          <div class="form-dialog-body">
            <slot />
          </div>
          <footer class="modal-footer">
            <slot name="footer" />
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
</template>
