<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Flame, ShieldCheck, Cpu, Undo2 } from '../../icons';
import appIcon from '../../assets/icon.png';
import { burstFrom, stamp } from '../../theme/effects';
import { t } from '../../theme/themes';

const emit = defineEmits<{ close: [] }>();
const button = ref<HTMLButtonElement>();
onMounted(() => button.value?.focus());

function enter() {
  burstFrom(button.value, 80, 1.8, 'spark');
  stamp('BASED');
  emit('close');
}
</script>

<template>
  <div
    class="modal-backdrop welcome-backdrop"
    @keydown.esc="enter"
  >
    <section
      class="welcome-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <img
        class="welcome-dialog-icon"
        :src="appIcon"
        alt=""
      >
      <h2 id="welcome-title">
        basedcode
      </h2>
      <p class="welcome-dialog-lede">
        {{
          t(
            'Welcome to the most Based coding agent ever slopped up on this green earth. Finally a code agent with some fuckin balls between its legs 🔥',
          )
        }}
      </p>
      <ul class="welcome-dialog-points">
        <li>
          <Cpu :size="16" /><span><strong>{{ t('Any model, your rules.') }}</strong>
            {{
              t(
                'Ollama, LM Studio, Claude Code. Swap them like trading cards. Fall back without blinking.',
              )
            }}</span>
        </li>
        <li>
          <ShieldCheck :size="16" /><span><strong>{{ t('Nothing happens without you.') }}</strong>
            {{
              t('Every task, command and install waits for your nod. Based and responsible.')
            }}</span>
        </li>
        <li>
          <Undo2 :size="16" /><span><strong>{{ t('Every prompt is a checkpoint.') }}</strong>
            {{ t("Didn't like it? Revert. Files and chat roll back. Zero regrets.") }}</span>
        </li>
      </ul>
      <button
        ref="button"
        class="primary-button welcome-dialog-go"
        @click="enter"
      >
        <Flame :size="16" /> {{ t('Get based') }}
      </button>
    </section>
  </div>
</template>
