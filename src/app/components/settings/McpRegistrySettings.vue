<script setup lang="ts">
import { defaultMcpRegistries, type GlobalSettings } from '../../../shared/types';
import { Plus, Trash2 } from '../../icons';
import { t } from '../../theme/themes';

const registries = defineModel<NonNullable<GlobalSettings['mcpRegistries']>>({ required: true });

function restoreRegistries() {
  registries.value = structuredClone(defaultMcpRegistries);
}

function addRegistry() {
  registries.value.push({
    id: crypto.randomUUID(),
    name: '',
    url: 'https://',
    enabled: true,
  });
}
</script>

<template>
  <details class="provider-card">
    <summary>{{ t('Registries') }}</summary>
    <p class="muted">
      {{
        t(
          'Any registry that implements the MCP Registry API (GET /servers). Include the API version in the URL.',
        )
      }}
    </p>
    <div
      v-for="(registry, index) in registries"
      :key="registry.id"
      class="mcp-registry"
    >
      <input
        class="switch"
        type="checkbox"
        role="switch"
        :checked="registry.enabled"
        :aria-label="registry.name"
        @change="registry.enabled = ($event.target as HTMLInputElement).checked"
      >
      <input
        v-model="registry.name"
        :placeholder="t('Name')"
        autocomplete="off"
      >
      <input
        v-model="registry.url"
        placeholder="https://…/v0.1"
        autocomplete="off"
        spellcheck="false"
      >
      <button
        class="icon-button"
        :title="t('Remove registry')"
        @click="registries.splice(index, 1)"
      >
        <Trash2 :size="14" />
      </button>
    </div>
    <button
      class="secondary-button"
      @click="addRegistry"
    >
      <Plus :size="14" /> {{ t('Add registry') }}
    </button>
    <button
      class="text-button"
      @click="restoreRegistries"
    >
      {{ t('Restore defaults') }}
    </button>
  </details>
</template>

<style scoped>
.provider-card {
  margin: 6px 0;
  padding: 10px 12px;
}
.mcp-registry {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}
.mcp-registry input:not(.switch) {
  flex: 1;
  min-width: 0;
}
</style>
