<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CommandRules, RunBudget } from '../../../shared/types';
import { t } from '../../theme/themes';

/**
 * Command rules and run budget fields, shared by app and workspace settings. With `inheritedBudget`, the budget can
 * follow the app default (`budget` undefined) or be set for this workspace; `inheritedRules` lists app-wide rules
 * that also apply.
 */
const props = defineProps<{ inheritedBudget?: RunBudget; inheritedRules?: CommandRules }>();
const rules = defineModel<CommandRules | undefined>('commandRules');
const budget = defineModel<RunBudget | undefined>('budget');

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
const allowText = ref((rules.value?.allow ?? []).join('\n'));
const denyText = ref((rules.value?.deny ?? []).join('\n'));
watch([allowText, denyText], () => {
  rules.value = { allow: lines(allowText.value), deny: lines(denyText.value) };
});

const inherits = computed(() => props.inheritedBudget !== undefined && budget.value === undefined);
const shown = computed(() => budget.value ?? props.inheritedBudget ?? {});
function setInherit(value: boolean) {
  budget.value = value ? undefined : { ...(props.inheritedBudget ?? {}) };
}
// Empty fields mean no limit; v-model.number gives '' for a cleared input.
function setLimit(key: keyof RunBudget, raw: string) {
  const value = Number(raw);
  budget.value = { ...(budget.value ?? {}), [key]: raw.trim() && value > 0 ? value : undefined };
}
const inheritedCount = computed(
  () => (props.inheritedRules?.allow.length ?? 0) + (props.inheritedRules?.deny.length ?? 0),
);
</script>

<template>
  <h3>{{ t('Command rules') }}</h3>
  <p class="muted">
    {{
      t(
        'One pattern per line; * matches anything. Deny rules win and apply in every mode. Allowed commands run without asking, even when they are chained with other allowed commands.',
      )
    }}
  </p>
  <p
    v-if="inheritedCount"
    class="muted small"
  >
    {{
      t('{count} app-wide rule(s) also apply here (App settings → Agent).', {
        count: String(inheritedCount),
      })
    }}
  </p>
  <div class="form-grid">
    <label>{{ t('Allow')
    }}<textarea
      v-model="allowText"
      autocomplete="off"
      class="code-input"
      rows="4"
      spellcheck="false"
      placeholder="npm test&#10;git log *"
    /></label><label>{{ t('Deny')
    }}<textarea
      v-model="denyText"
      autocomplete="off"
      class="code-input"
      rows="4"
      spellcheck="false"
      placeholder="rm -rf *"
    />
    </label>
  </div>
  <h3>{{ t('Run budget') }}</h3>
  <p class="muted">
    {{
      t(
        'A run that reaches a limit pauses and asks whether to continue. Leave a field empty for no limit. Cost is only known for some providers.',
      )
    }}
  </p>
  <label
    v-if="inheritedBudget !== undefined"
    class="checkbox"
  ><input
     :checked="inherits"
     type="checkbox"
     @change="setInherit(($event.target as HTMLInputElement).checked)"
   >
    {{ t('Use the app default budget') }}</label>
  <div class="form-grid">
    <label>{{ t('Tool calls')
    }}<input
      :value="shown.maxToolCalls ?? ''"
      :disabled="inherits"
      type="number"
      min="1"
      @change="setLimit('maxToolCalls', ($event.target as HTMLInputElement).value)"
    ></label><label>{{ t('Tokens')
    }}<input
      :value="shown.maxTokens ?? ''"
      :disabled="inherits"
      type="number"
      min="1000"
      step="1000"
      @change="setLimit('maxTokens', ($event.target as HTMLInputElement).value)"
    ></label><label>{{ t('Cost · USD')
    }}<input
      :value="shown.maxCostUsd ?? ''"
      :disabled="inherits"
      type="number"
      min="0.01"
      step="0.01"
      @change="setLimit('maxCostUsd', ($event.target as HTMLInputElement).value)"
    ></label>
  </div>
</template>
