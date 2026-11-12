<script setup lang="ts">
import { computed, ref } from 'vue';
import { ListChecks, Circle, CircleDot, CircleCheck, ChevronRight } from '../../icons';
import { t } from '../../theme/themes';

export type PlanStep = { step: string; status: 'pending' | 'in_progress' | 'completed' };
const props = defineProps<{ steps: PlanStep[] }>();
const done = computed(() => props.steps.filter((item) => item.status === 'completed').length);
const current = computed(
  () => props.steps.find((item) => item.status === 'in_progress')?.step ?? '',
);
const expanded = ref(false);
</script>

<template>
  <div
    class="plan-panel"
    role="status"
  >
    <button
      type="button"
      class="plan-panel-title"
      :aria-expanded="expanded"
      :title="expanded ? t('Collapse plan') : t('Expand plan')"
      @click="expanded = !expanded"
    >
      <ChevronRight
        :size="14"
        class="plan-chevron"
        :class="{ open: expanded }"
      />
      <ListChecks :size="14" /><span>{{ t('Plan') }}</span>
      <span
        v-if="!expanded && current"
        class="plan-panel-current"
      >{{ current }}</span>
      <span class="plan-panel-count">{{
        t('{done}/{total} done', { done, total: steps.length })
      }}</span>
    </button>
    <ul
      v-if="expanded"
      class="plan-list"
    >
      <li
        v-for="(item, index) in steps"
        :key="index"
        :class="item.status"
      >
        <CircleCheck
          v-if="item.status === 'completed'"
          :size="14"
          class="success-text"
          :aria-label="t('Completed')"
        />
        <CircleDot
          v-else-if="item.status === 'in_progress'"
          :size="14"
          :aria-label="t('In progress')"
        />
        <Circle
          v-else
          :size="14"
          :aria-label="t('Pending')"
        />
        <span>{{ item.step }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.plan-panel {
  box-sizing: border-box;
  max-width: 760px;
  margin: 0 auto 6px;
  padding: 6px 10px;
  border: 1px solid var(--border, rgba(127, 127, 127, 0.3));
  border-radius: 8px;
  max-height: 30vh;
  overflow-y: auto;
}
.plan-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 600;
  font-size: 0.9em;
  text-align: left;
  cursor: pointer;
}
.plan-chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.plan-chevron.open {
  transform: rotate(90deg);
}
.plan-panel-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  opacity: 0.85;
}
.plan-panel-count {
  margin-left: auto;
  flex-shrink: 0;
  font-weight: 400;
  opacity: 0.7;
}
.plan-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.plan-list li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.plan-list li.completed span {
  text-decoration: line-through;
  opacity: 0.65;
}
.plan-list li.in_progress span {
  font-weight: 600;
}
</style>
