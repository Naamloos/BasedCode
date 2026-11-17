<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Copy, ExternalLink, FileText } from '../../icons';
import type { ArtifactType, Message } from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';
import AppSelect from '../common/AppSelect.vue';
import ZoomFrame from '../common/ZoomFrame.vue';
import MarkdownView from '../chat/MarkdownView.vue';

/** Either a tool message (shows the version it wrote) or an artifact id (shows the latest), as in the Artifacts tab. */
const props = defineProps<{ message?: Message; artifactId?: string; workspaceId?: string; tall?: boolean }>();
const emit = defineEmits<{ open: [artifact: { id: string; title: string }] }>();

interface Loaded {
  id: string;
  title: string;
  mediaType: ArtifactType;
  version: number;
  versions: number;
  content: string;
  history: { version: number; createdAt: string; note?: string }[];
}

type ToolState = {
  name: string;
  args: { title?: string };
  status: string;
  result?: { id?: string; version?: number };
  error?: string;
};
// Opened by id, the view behaves like a finished tool call that wrote the latest version.
const tool = computed<ToolState>(() =>
  props.message
    ? (props.message.metadata.tool as ToolState)
    : { name: 'artifact_read', args: {}, status: 'completed', result: { id: props.artifactId } },
);
const artifact = ref<Loaded>();
const version = ref<number>();
const frameUrl = ref('');
const error = ref('');
const copied = ref(false);

async function load(requested?: number) {
  const artifactId = tool.value.result?.id;
  if (!artifactId) return;
  error.value = '';
  try {
    const loaded = await rpc<Loaded>('artifact.get', {
      artifactId,
      ...(requested ? { version: requested } : {}),
    });
    artifact.value = loaded;
    version.value = loaded.version;
    frameUrl.value =
      loaded.mediaType === 'text/html'
        ? (await rpc<{ url: string }>('artifact.view', { artifactId, version: loaded.version })).url
        : '';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
}
// Show the version this tool call wrote; the picker reaches the others.
watch(
  () => [tool.value.status, tool.value.result?.id] as const,
  ([status]) => {
    if (status === 'completed') void load(tool.value.result?.version);
  },
  { immediate: true },
);

const versionOptions = computed(() =>
  (artifact.value?.history ?? [])
    .map((item) => ({
      value: String(item.version),
      label: `${t('Version {n}', { n: item.version })} · ${new Date(item.createdAt).toLocaleString()}${item.note ? ` · ${item.note}` : ''}`,
    }))
    .reverse(),
);
const svgUrl = computed(() =>
  artifact.value?.mediaType === 'image/svg+xml'
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.value.content)}`
    : '',
);
const prettyJson = computed(() => {
  if (artifact.value?.mediaType !== 'application/json') return '';
  try {
    return JSON.stringify(JSON.parse(artifact.value.content), null, 2);
  } catch {
    return artifact.value.content;
  }
});
async function copy() {
  if (!artifact.value) return;
  await navigator.clipboard.writeText(artifact.value.content);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div
    class="artifact-view"
    :class="{ tall }"
  >
    <div class="artifact-header">
      <FileText :size="13" />
      <strong>{{ artifact?.title ?? tool.args.title ?? t('Artifact') }}</strong>
      <span
        v-if="artifact"
        class="muted small"
      >{{ artifact.mediaType }}</span>
      <span class="spacer" />
      <AppSelect
        v-if="artifact && artifact.versions > 1"
        :model-value="String(version)"
        :options="versionOptions"
        :aria-label="t('Version')"
        @update:model-value="(value: string) => load(Number(value))"
      />
      <button
        v-if="artifact && message"
        type="button"
        class="icon-button"
        :title="t('Open in a tab')"
        :aria-label="t('Open in a tab')"
        @click="emit('open', { id: artifact.id, title: artifact.title })"
      >
        <ExternalLink :size="14" />
      </button>
      <button
        v-if="artifact"
        type="button"
        class="icon-button"
        :title="copied ? t('Copied') : t('Copy content')"
        :aria-label="t('Copy content')"
        @click="copy"
      >
        <Copy :size="14" />
      </button>
    </div>
    <p
      v-if="error || tool.error"
      class="error-text"
    >
      {{ error || tool.error }}
    </p>
    <p
      v-else-if="tool.status === 'running'"
      class="muted small"
    >
      {{ t('Writing artifact…') }}
    </p>
    <template v-else-if="artifact">
      <ZoomFrame
        v-if="frameUrl"
        :title="artifact.title"
        interactive
      >
        <iframe
          :src="frameUrl"
          class="artifact-frame"
          :title="artifact.title"
          sandbox="allow-scripts allow-forms allow-downloads"
          referrerpolicy="no-referrer"
        />
      </ZoomFrame>
      <MarkdownView
        v-else-if="artifact.mediaType === 'text/markdown'"
        class="artifact-body"
        :content="artifact.content"
        :workspace-id="workspaceId"
      />
      <img
        v-else-if="svgUrl"
        class="artifact-image"
        :src="svgUrl"
        :alt="artifact.title"
      >
      <pre
        v-else
        class="artifact-body artifact-text"
      >{{ prettyJson || artifact.content }}</pre>
    </template>
  </div>
</template>

<style scoped>
.artifact-view {
  margin: 6px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  overflow: hidden;
}
.artifact-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
}
.artifact-header :deep(.app-select) {
  max-width: 280px;
}
.artifact-body {
  max-height: 480px;
  margin: 0;
  padding: 10px 14px;
  overflow: auto;
}
.artifact-text {
  font-family: var(--font-code);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.artifact-frame {
  display: block;
  width: 100%;
  height: 420px;
  border: 0;
  background: var(--bg);
}
.artifact-image {
  display: block;
  max-width: 100%;
  max-height: 480px;
  margin: 10px auto;
}
.tall .artifact-body,
.tall .artifact-image {
  max-height: none;
}
.tall .artifact-frame {
  height: 70vh;
}
.error-text,
.muted.small {
  margin: 8px 12px;
}
</style>
