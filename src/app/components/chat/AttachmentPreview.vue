<script setup lang="ts">
import type { PreviewItem } from '../../state/attachments';
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { X, FileText, Download } from '../../icons';
import hljs from 'highlight.js';
import { formatSize } from '../../utils/format';
import { t } from '../../theme/themes';

const props = defineProps<{ item: PreviewItem }>();
const emit = defineEmits<{ close: [] }>();
const text = ref<string>();
const highlighted = ref('');
const error = ref('');
const textLimit = 400_000;

const image = /^image\/(png|jpeg|gif|webp)$/.test(props.item.mediaType);
const pdf = props.item.mediaType === 'application/pdf';
const textual =
  !image &&
  !pdf &&
  (props.item.mediaType.startsWith('text/') ||
    /json|xml|yaml|toml|javascript|typescript/.test(props.item.mediaType) ||
    /\.(txt|md|json|ya?ml|toml|csv|log|xml|html?|css|[cm]?[jt]sx?|vue|py|rb|go|rs|java|cs|cpp|c|h|sh|ps1|sql)$/i.test(
      props.item.name,
    ));

onMounted(async () => {
  if (!textual) return;
  try {
    const content = props.item.file
      ? await props.item.file.text()
      : props.item.url
        ? await (await fetch(props.item.url)).text()
        : '';
    const previewText =
      content.length > textLimit
        ? `${content.slice(0, textLimit)}\n\n… (${t('{count} more characters', { count: content.length - textLimit })})`
        : content;
    text.value = previewText;
    // Highlighting a very large file would stall the UI; show it plain instead.
    highlighted.value = previewText.length < 150_000 ? hljs.highlightAuto(previewText).value : '';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
});
const keydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close');
};
onMounted(() => window.addEventListener('keydown', keydown));
onBeforeUnmount(() => window.removeEventListener('keydown', keydown));
</script>

<template>
  <div
    class="modal-backdrop"
    @click.self="emit('close')"
  >
    <section
      class="attachment-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Preview of {name}', { name: item.name })"
    >
      <header class="modal-header">
        <div>
          <h2>{{ item.name }}</h2>
          <small class="muted">{{ item.mediaType }} · {{ formatSize(item.size) }}</small>
        </div>
        <a
          v-if="item.url"
          class="icon-button"
          :href="item.url"
          :download="item.name"
          :title="t('Save a copy')"
        ><Download :size="17" /></a><button
          class="icon-button"
          :aria-label="t('Close preview')"
          @click="emit('close')"
        >
          <X :size="19" />
        </button>
      </header>
      <div class="attachment-body">
        <img
          v-if="image && item.url"
          :src="item.url"
          :alt="item.name"
        >
        <iframe
          v-else-if="pdf && item.url"
          :src="item.url"
          :title="item.name"
          sandbox=""
        />
        <p
          v-else-if="error"
          class="error-text"
        >
          {{ error }}
        </p>
        <!-- highlight.js escapes the file text; nothing from the file is rendered as markup. -->
        <!-- eslint-disable vue/no-v-html -->
        <pre
          v-else-if="highlighted"
          class="hljs"
        ><code v-html="highlighted" /></pre>
        <!-- eslint-enable vue/no-v-html -->
        <pre v-else-if="text !== undefined"><code>{{ text }}</code></pre>
        <div
          v-else
          class="attachment-unknown"
        >
          <FileText :size="40" />
          <p class="muted">
            {{
              t(
                'No preview for this file type. The model receives a note that it was attached, not its contents.',
              )
            }}
          </p>
        </div>
      </div>
    </section>
  </div>
</template>
