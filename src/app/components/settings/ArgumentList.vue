<script setup lang="ts">
import { ChevronDown, ChevronUp, Plus, Trash2 } from '../../icons';
import { t } from '../../theme/themes';

const args = defineModel<string[]>({ required: true });

function move(index: number, direction: number) {
  const next = [...args.value];
  const target = index + direction;
  [next[index], next[target]] = [next[target], next[index]];
  args.value = next;
}
</script>

<template>
  <fieldset class="argument-list">
    <legend>{{ t('Arguments') }}</legend>
    <div
      v-for="(arg, index) in args"
      :key="index"
      class="argument-row"
    >
      <input
        :value="arg"
        :aria-label="t('Argument {number}', { number: index + 1 })"
        autocomplete="off"
        spellcheck="false"
        @input="args[index] = ($event.target as HTMLInputElement).value"
      >
      <button
        type="button"
        class="icon-button"
        :title="t('Move up')"
        :aria-label="t('Move up')"
        :disabled="index === 0"
        @click="move(index, -1)"
      >
        <ChevronUp :size="15" />
      </button>
      <button
        type="button"
        class="icon-button"
        :title="t('Move down')"
        :aria-label="t('Move down')"
        :disabled="index === args.length - 1"
        @click="move(index, 1)"
      >
        <ChevronDown :size="15" />
      </button>
      <button
        type="button"
        class="icon-button"
        :title="t('Remove argument')"
        :aria-label="t('Remove argument')"
        @click="args.splice(index, 1)"
      >
        <Trash2 :size="15" />
      </button>
    </div>
    <button
      type="button"
      class="secondary-button"
      @click="args.push('')"
    >
      <Plus :size="15" /> {{ t('Add argument') }}
    </button>
  </fieldset>
</template>

<style scoped>
.argument-list {
  display: grid;
  justify-items: start;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.argument-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.argument-row input {
  flex: 1;
  min-width: 0;
}
</style>
