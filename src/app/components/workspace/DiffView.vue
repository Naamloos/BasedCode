<script setup lang="ts">
import { computed } from 'vue';
import { fullFileDiff, numberDiff, splitDiff } from '../../utils/diff';

/** With `content`, shows the whole file with the diff laid over it instead of just the hunks. */
const props = defineProps<{ diff: string; layout: 'unified' | 'split'; content?: string }>();
const unified = computed(() =>
  props.content !== undefined
    ? fullFileDiff(props.content, props.diff)
    : props.layout === 'unified'
      ? numberDiff(props.diff)
      : [],
);
const split = computed(() =>
  props.layout === 'split' && props.content === undefined ? splitDiff(props.diff) : [],
);
</script>

<template>
  <div
    v-if="layout === 'unified' || content !== undefined"
    class="diff-unified"
  >
    <div
      v-for="(line, index) in unified"
      :key="index"
      class="diff-row"
    >
      <span
        class="diff-number"
        :class="line.kind"
      >{{ line.old }}</span><span
        class="diff-number"
        :class="line.kind"
      >{{ line.new }}</span><span
        class="diff-line"
        :class="line.kind"
      >{{ line.text || ' ' }}</span>
    </div>
  </div>
  <div
    v-else
    class="diff-split"
  >
    <template
      v-for="(row, index) in split"
      :key="index"
    >
      <div
        v-if="row.type !== 'pair'"
        class="diff-split-wide"
        :class="row.type"
      >
        {{ row.text }}
      </div>
      <template v-else>
        <span
          class="diff-number"
          :class="row.left.kind"
        >{{ row.left.number }}</span><span
          class="diff-cell"
          :class="row.left.kind"
        >{{ row.left.kind === 'deletion' ? '−' : ' ' }} {{ row.left.text }}</span><span
          class="diff-number"
          :class="row.right.kind"
        >{{ row.right.number }}</span><span
          class="diff-cell"
          :class="row.right.kind"
        >{{ row.right.kind === 'addition' ? '+' : ' ' }} {{ row.right.text }}</span>
      </template>
    </template>
  </div>
</template>
