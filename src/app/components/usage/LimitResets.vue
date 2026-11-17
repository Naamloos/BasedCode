<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LimitReset, ProviderLimits } from '../../../shared/types';
import { t } from '../../theme/i18n';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';

// One summary line for the account's usage resets; Use spends the one that expires first, after confirmation.
const props = defineProps<{ limits: ProviderLimits; name: string; atLimit: boolean }>();

const resets = computed(() =>
  [...(props.limits.resets ?? [])].sort(
    (a, b) =>
      Number(Boolean(a.unavailableReason)) - Number(Boolean(b.unavailableReason)) ||
      (a.expiresAt ? Date.parse(a.expiresAt) : Infinity) -
        (b.expiresAt ? Date.parse(b.expiresAt) : Infinity),
  ),
);
const total = computed(() => resets.value.reduce((sum, reset) => sum + (reset.left ?? 1), 0));
const usable = (reset: LimitReset) =>
  !reset.unavailableReason && (reset.usableNow !== false || props.atLimit);
const next = computed(() => resets.value.find(usable));
const using = ref(false);
const note = ref('');

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const summary = computed(() => {
  const first = resets.value[0];
  if (!first) return '';
  if (first.unavailableReason && !next.value)
    // "surface": Claude only offers resets inside its own apps; say where to go instead.
    return first.unavailableReason === 'surface'
      ? t('Use it in Claude Code with /limit-reset')
      : t("Can't be used from BasedCode ({reason})", { reason: first.unavailableReason });
  if (!next.value) return t('once you reach a limit');
  return next.value.expiresAt ? t('use by {date}', { date: shortDate(next.value.expiresAt) }) : '';
});
const tooltip = computed(() =>
  resets.value
    .map((reset) =>
      [reset.label, reset.expiresAt ? t('use by {date}', { date: shortDate(reset.expiresAt) }) : '']
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n'),
);

// Spending a reset cannot be undone, so it always asks first.
async function use() {
  const kind = props.limits.kind;
  const reset = next.value;
  if (!reset || (kind !== 'codex' && kind !== 'claude') || using.value) return;
  if (
    !(await confirmAction(
      t('Use a {name} reset?', { name: props.name }),
      `${reset.label}. ${t('Refills your {name} usage limits now. The reset is used up and this cannot be undone.', {
        name: props.name,
      })}${props.atLimit ? '' : ` ${t("You haven't reached a limit yet.")}`}`,
      t('Use reset'),
    ))
  )
    return;
  using.value = true;
  note.value = '';
  try {
    const result = await rpc<{ ok: boolean; message: string }>('limits.useReset', {
      kind,
      resetId: reset.id,
    });
    note.value = t(result.message);
  } catch (failure) {
    note.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    using.value = false;
  }
}
</script>

<template>
  <div
    v-if="resets.length"
    class="limit-resets"
    :class="{ urgent: atLimit && next }"
    :title="tooltip"
  >
    <span class="limit-resets-count">{{ t('{count} reset(s)', { count: total }) }}</span>
    <span class="limit-resets-detail">{{ summary }}</span>
    <button
      v-if="next"
      type="button"
      class="limit-resets-use"
      :disabled="using"
      @click="use"
    >
      {{ using ? t('Using…') : t('Use') }}
    </button>
  </div>
  <p
    v-else-if="limits.resetsHidden"
    class="limit-meta"
    :title="t('Claude only shows limit resets in its own apps, so BasedCode cannot see or use them.')"
  >
    {{ t('Resets: check /limit-reset in Claude Code') }}
  </p>
  <p
    v-if="note"
    class="limit-meta"
    role="status"
  >
    {{ note }}
  </p>
</template>
