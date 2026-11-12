<script setup lang="ts">
import { computed, ref } from 'vue';
import { Image } from '../../icons';
import type { Message } from '../../../shared/types';
import { attachmentUrl, mediaUrl } from '../../services/api';
import { t } from '../../theme/themes';
import ZoomFrame from '../common/ZoomFrame.vue';

const props = defineProps<{ message: Message; workspaceId: string }>();
const tool = computed(
  () =>
    props.message.metadata.tool as {
      args: { path?: string; url?: string; caption?: string };
      status: string;
      result?: { path?: string; attachmentId?: string };
      error?: string;
    },
);
const src = computed(() => {
  const result = tool.value.result;
  if (result?.attachmentId) return attachmentUrl(result.attachmentId);
  if (result?.path) return mediaUrl(props.workspaceId, result.path);
  return '';
});
const label = computed(
  () => tool.value.args.caption ?? tool.value.args.path ?? tool.value.args.url ?? t('Image'),
);
const broken = ref(false);
</script>

<template>
  <figure class="image-view">
    <div class="eyebrow">
      <Image :size="12" /> {{ tool.args.path ?? tool.args.url }}
    </div>
    <p
      v-if="tool.error || broken"
      class="error-text"
    >
      {{ tool.error ?? t('The image could not be loaded.') }}
    </p>
    <ZoomFrame
      v-else-if="src"
      :title="label"
    >
      <img
        :src="src"
        :alt="label"
        referrerpolicy="no-referrer"
        @error="broken = true"
      >
    </ZoomFrame>
    <figcaption v-if="tool.args.caption">
      {{ tool.args.caption }}
    </figcaption>
  </figure>
</template>

<style scoped>
.image-view {
  margin: 6px 0;
  display: grid;
  gap: 6px;
  justify-items: start;
}
.image-view .eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.image-view img {
  max-width: 100%;
  max-height: 520px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.image-view figcaption {
  font-size: 12px;
  color: var(--muted);
}
</style>
