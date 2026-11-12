<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { ChevronDown } from '../../icons';
import { t } from '../../theme/themes';

defineOptions({ inheritAttrs: false });
const model = defineModel<string>({ required: true });
const props = defineProps<{
  options: { value: string; label: string }[];
  editable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ change: [value: string] }>();
const id = useId();
const root = ref<HTMLElement>();
const menu = ref<HTMLElement>();
const control = ref<HTMLElement>();
const open = ref(false);
const active = ref(0);
const position = ref({ left: '0px', top: '0px', width: '0px', maxHeight: '240px' });
const options = computed(() =>
  props.editable
    ? props.options.filter((option) =>
        option.label.toLowerCase().includes(model.value.toLowerCase()),
      )
    : props.options,
);
const label = computed(
  () => props.options.find((option) => option.value === model.value)?.label ?? model.value,
);
async function show() {
  if (props.disabled) return;
  const box = control.value!.getBoundingClientRect();
  const below = window.innerHeight - box.bottom;
  const height = Math.max(80, Math.min(240, below > 120 ? below - 8 : box.top - 8));
  position.value = {
    left: `${Math.max(4, Math.min(box.left, window.innerWidth - box.width - 4))}px`,
    top: `${below > 120 ? box.bottom + 4 : Math.max(4, box.top - height - 4)}px`,
    width: `${box.width}px`,
    maxHeight: `${height}px`,
  };
  active.value = Math.max(
    0,
    options.value.findIndex((option) => option.value === model.value),
  );
  open.value = true;
  await nextTick();
  scrollActive();
}
function scrollActive() {
  menu.value
    ?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}
function choose(value: string) {
  model.value = value;
  emit('change', value);
  open.value = false;
  control.value?.focus();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    event.stopPropagation();
    open.value = false;
    return;
  }
  if (event.key === 'Tab') {
    open.value = false;
    return;
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    if (props.editable && !open.value && ['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open.value) {
      void show();
      return;
    }
    const last = options.value.length - 1;
    active.value =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : Math.max(0, Math.min(last, active.value + (event.key === 'ArrowDown' ? 1 : -1)));
    void nextTick(scrollActive);
  } else if (event.key === 'Enter' && open.value) {
    event.preventDefault();
    const option = options.value[active.value];
    if (option) choose(option.value);
  }
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node) && !menu.value?.contains(event.target as Node))
    open.value = false;
}
function close(event?: Event) {
  if (!event || !menu.value?.contains(event.target as Node)) open.value = false;
}
onMounted(() => {
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside);
  window.removeEventListener('resize', close);
  document.removeEventListener('scroll', close, true);
});
</script>

<template>
  <div
    ref="root"
    class="app-select"
  >
    <input
      v-if="editable"
      ref="control"
      v-bind="$attrs"
      v-model="model"
      role="combobox"
      autocomplete="off"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-activedescendant="open && options.length ? `${id}-${active}` : undefined"
      aria-autocomplete="list"
      @focus="show"
      @input="show"
      @keydown="keydown"
    >
    <button
      v-else
      ref="control"
      v-bind="$attrs"
      type="button"
      class="app-select-control"
      role="combobox"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-activedescendant="open && options.length ? `${id}-${active}` : undefined"
      @click="open ? close() : show()"
      @keydown="keydown"
    >
      <span>{{ label || placeholder }}</span><ChevronDown :size="14" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        :id="id"
        ref="menu"
        class="app-select-menu"
        role="listbox"
        :style="position"
      >
        <button
          v-for="(option, index) in options"
          :id="`${id}-${index}`"
          :key="option.value"
          type="button"
          role="option"
          :aria-selected="option.value === model"
          :data-index="index"
          :class="{ active: index === active }"
          @mousedown.prevent
          @click="choose(option.value)"
        >
          {{ option.label }}
        </button>
        <span
          v-if="!options.length"
          class="app-select-empty"
        >{{ t('No matches') }}</span>
      </div>
    </Teleport>
  </div>
</template>
