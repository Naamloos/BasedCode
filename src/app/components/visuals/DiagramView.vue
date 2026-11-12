<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import DOMPurify from 'dompurify';
import { Network } from '../../icons';
import type { Message } from '../../../shared/types';
import { t } from '../../theme/themes';
import ZoomFrame from '../common/ZoomFrame.vue';

const props = defineProps<{ message: Message }>();
const tool = computed(
  () =>
    props.message.metadata.tool as {
      args: { title?: string; code: string };
      status: string;
      error?: string;
    },
);
const svg = ref('');
const error = ref('');
let observer: MutationObserver | undefined;
let sequence = 0;

/** Draws the diagram with the app's current theme tokens. Mermaid loads on first use; it is large. */
async function draw() {
  if (tool.value.status !== 'completed') return;
  const attempt = ++sequence;
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();
  const dark = document.documentElement.dataset.scheme !== 'light';
  try {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      // Strict sanitizes labels and disables click handlers and links in agent-written source.
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: root.fontFamily,
      themeVariables: {
        darkMode: dark,
        background: token('--surface'),
        primaryColor: token('--surface-raised'),
        primaryTextColor: token('--text'),
        primaryBorderColor: token('--accent'),
        secondaryColor: token('--surface-hover'),
        tertiaryColor: token('--surface'),
        lineColor: token('--muted'),
        textColor: token('--text'),
        mainBkg: token('--surface-raised'),
        nodeBorder: token('--border-strong') || token('--border'),
        clusterBkg: token('--surface'),
        clusterBorder: token('--border-strong') || token('--border'),
        edgeLabelBackground: token('--surface'),
      },
    });
    const { svg: drawn } = await mermaid.render(
      `diagram-${props.message.id.replace(/\W/g, '')}-${attempt}`,
      tool.value.args.code,
    );
    if (attempt !== sequence) return;
    // Labels are HTML inside <foreignObject>; DOMPurify drops that unless it is declared an HTML integration point.
    svg.value = DOMPurify.sanitize(drawn, {
      USE_PROFILES: { svg: true, svgFilters: true, html: true },
      ADD_TAGS: ['foreignObject'],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
    });
    error.value = '';
  } catch (failure) {
    if (attempt === sequence)
      error.value = failure instanceof Error ? failure.message : String(failure);
  }
}
onMounted(() => {
  void draw();
  observer = new MutationObserver(() => void draw());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-scheme'],
  });
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <figure class="diagram-view">
    <div class="eyebrow">
      <Network :size="12" /> {{ tool.args.title ?? t('Diagram') }}
    </div>
    <p
      v-if="tool.error || error"
      class="error-text"
    >
      {{ tool.error ?? t('The diagram could not be drawn: {error}', { error }) }}
    </p>
    <!-- Mermaid sanitizes under securityLevel strict, and the SVG goes through DOMPurify again before it lands here. -->
    <ZoomFrame
      v-if="svg && !error"
      :title="tool.args.title ?? t('Diagram')"
    >
      <!-- eslint-disable vue/no-v-html -->
      <div
        class="diagram-svg"
        v-html="svg"
      />
      <!-- eslint-enable vue/no-v-html -->
    </ZoomFrame>
    <details
      v-if="tool.args.code"
      class="diagram-source"
      :open="!!error"
    >
      <summary>{{ t('Source') }}</summary>
      <pre>{{ tool.args.code }}</pre>
    </details>
  </figure>
</template>

<style scoped>
.diagram-view {
  margin: 6px 0;
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.diagram-view .eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.diagram-svg {
  overflow-x: auto;
  display: flex;
  justify-content: center;
}
.diagram-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}
.diagram-source summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
}
.diagram-source pre {
  margin: 6px 0 0;
  font-size: 12px;
  overflow-x: auto;
}
</style>
