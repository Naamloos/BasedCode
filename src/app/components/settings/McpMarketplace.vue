<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  LoaderCircle,
  Plug,
  Search,
  X,
} from '../../icons';
import {
  defaultMcpRegistries,
  type GlobalSettings,
  type McpInstallOption,
  type McpRegistryServer,
  type ServerConfig,
  type Workspace,
} from '../../../shared/types';
import { rpc } from '../../services/api';
import { t } from '../../theme/themes';
import AppSelect from '../common/AppSelect.vue';
import McpRegistrySettings from './McpRegistrySettings.vue';
import InstalledMcpServers from './InstalledMcpServers.vue';

/**
 * App-wide MCP servers: browse registries, install with generated fields, and manage what is installed.
 * Server configs live in `settings.mcpServers` (saved with the panel); secrets and sign-ins go straight to the
 * backend credential store and never enter settings.
 */
defineProps<{ workspace?: Workspace }>();
const installedServers = ref<InstanceType<typeof InstalledMcpServers>>();
/** The panel's editable settings; edited in place and saved by the panel. */
const settings = defineModel<GlobalSettings>('settings', { required: true });
/** Ask the panel to persist the current settings now; `done` receives whether saving worked. */
const emit = defineEmits<{ save: [done: (ok: boolean) => void]; error: [message: string] }>();

settings.value.mcpRegistries ??= structuredClone(defaultMcpRegistries);
const registries = computed(() => settings.value.mcpRegistries!);
const enabledRegistries = computed(() => registries.value.filter((item) => item.enabled));

const view = ref<'installed' | 'browse'>(settings.value.mcpServers.length ? 'installed' : 'browse');
const registryId = ref(enabledRegistries.value[0]?.id ?? '');
const search = ref('');
const results = ref<McpRegistryServer[]>([]);
const nextCursor = ref<string>();
const searching = ref(false);
const browseError = ref('');

function fail(failure: unknown) {
  emit('error', failure instanceof Error ? failure.message : String(failure));
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
async function runSearch(more = false) {
  if (!registryId.value) return;
  searching.value = true;
  browseError.value = '';
  try {
    const page = await rpc<{
      servers: McpRegistryServer[];
      nextCursor?: string;
    }>('mcp.registry.search', {
      registryId: registryId.value,
      search: search.value,
      cursor: more ? nextCursor.value : undefined,
    });
    results.value = more ? [...results.value, ...page.servers] : page.servers;
    nextCursor.value = page.servers.length ? page.nextCursor : undefined;
  } catch (failure) {
    browseError.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    searching.value = false;
  }
}
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void runSearch(), 350);
});
watch(registryId, () => void runSearch());
watch(view, (current) => {
  if (current === 'browse' && !results.value.length) void runSearch();
});
onMounted(() => {
  if (view.value === 'browse') void runSearch();
});

function installedFrom(server: McpRegistryServer) {
  return settings.value.mcpServers.find(
    (item) => item.registry?.registryId === registryId.value && item.registry.name === server.name,
  );
}
function transports(server: McpRegistryServer) {
  return [...new Set(server.options.map((option) => option.transport))];
}
function transportLabel(transport: ServerConfig['transport']) {
  return transport === 'stdio'
    ? t('Local stdio')
    : transport === 'sse'
      ? t('Remote SSE')
      : t('Remote HTTP');
}
function openLink(url?: string) {
  if (url) rpc('external.open', { url }).catch(fail);
}

// Install flow: pick an option, fill the fields generated from the registry metadata, install.
const installing = ref<McpRegistryServer>();
const optionId = ref('');
const values = ref<Record<string, string>>({});
const authMode = ref<'auto' | 'none' | 'oauth'>('auto');
const installBusy = ref(false);
const installError = ref('');
const option = computed<McpInstallOption | undefined>(() =>
  installing.value?.options.find((item) => item.id === optionId.value),
);
const installDialog = ref<HTMLElement>();
/** Where focus was before the dialog opened, so closing it returns there. */
let focusBefore: HTMLElement | null = null;
function closeInstall() {
  if (installBusy.value) return;
  installing.value = undefined;
  focusBefore?.focus();
}
function startInstall(server: McpRegistryServer) {
  focusBefore = document.activeElement as HTMLElement | null;
  installing.value = server;
  void nextTick(() =>
    installDialog.value?.querySelector<HTMLElement>('input, button.select, .modal-header button')?.focus(),
  );
  optionId.value =
    // Remote endpoints need no local runtime, so they are the simpler default.
    (server.options.find((item) => item.kind === 'remote') ?? server.options[0])?.id ?? '';
  installError.value = '';
  authMode.value = 'auto';
}
watch(option, (current) => {
  values.value = Object.fromEntries(
    (current?.fields ?? []).map((item) => [item.key, item.default ?? '']),
  );
});
const missing = computed(() =>
  (option.value?.fields ?? []).filter((item) => item.required && !values.value[item.key]?.trim()),
);
async function install() {
  if (!installing.value || !option.value || missing.value.length) return;
  installBusy.value = true;
  installError.value = '';
  try {
    const config = await rpc<ServerConfig>('mcp.registry.install', {
      registryId: registryId.value,
      name: installing.value.name,
      version: installing.value.version,
      optionId: option.value.id,
      values: Object.fromEntries(Object.entries(values.value).filter(([, value]) => value !== '')),
      auth: option.value.kind === 'remote' ? authMode.value : 'none',
    });
    // The backend saved it already; keep the panel's copy in step so a later Save does not drop it.
    settings.value.mcpServers.push(config);
    installing.value = undefined;
    view.value = 'installed';
    await nextTick();
    await installedServers.value?.activate(config);
  } catch (failure) {
    installError.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    installBusy.value = false;
  }
}


</script>

<template>
  <h3>{{ t('MCP servers') }}</h3>
  <p class="muted">
    {{
      t(
        'Servers installed here are available to every agent and model in every workspace. Keys and sign-ins are stored in your OS credential store. Connecting and each tool call still ask for approval.',
      )
    }}
  </p>
  <div
    class="mcp-views"
    role="tablist"
  >
    <button
      :class="{ active: view === 'installed' }"
      role="tab"
      :aria-selected="view === 'installed'"
      @click="view = 'installed'"
    >
      <Plug :size="14" /> {{ t('Installed') }} ·
      {{ settings.mcpServers.length }}
    </button>
    <button
      :class="{ active: view === 'browse' }"
      role="tab"
      :aria-selected="view === 'browse'"
      @click="view = 'browse'"
    >
      <Search :size="14" /> {{ t('Marketplace') }}
    </button>
  </div>

  <template v-if="view === 'browse'">
    <div class="mcp-search">
      <AppSelect
        v-model="registryId"
        :options="
          enabledRegistries.map((item) => ({
            value: item.id,
            label: item.name,
          }))
        "
      />
      <input
        v-model="search"
        type="search"
        autocomplete="off"
        :placeholder="t('Search MCP servers')"
        :aria-label="t('Search MCP servers')"
      >
    </div>
    <p
      v-if="!enabledRegistries.length"
      class="muted"
    >
      {{ t('Enable a registry below to browse servers.') }}
    </p>
    <p
      v-if="browseError"
      class="error-text"
      role="alert"
    >
      {{ browseError }}
    </p>

    <Teleport to="body">
      <div
        v-if="installing"
        class="modal-backdrop mcp-install-backdrop"
        @keydown.esc.stop.prevent="closeInstall"
        @click.self="closeInstall"
      >
        <section
          ref="installDialog"
          class="small-modal mcp-install"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mcp-install-title"
        >
          <header class="modal-header">
            <h2 id="mcp-install-title">
              {{ t('Install {name}', { name: installing.title ?? installing.name }) }}
            </h2>
            <button
              type="button"
              class="icon-button"
              :aria-label="t('Close')"
              @click="closeInstall"
            >
              <X :size="16" />
            </button>
          </header>
          <p class="muted">
            {{ installing.description }}
          </p>
          <p
            v-if="!installing.options.length"
            class="muted"
          >
            {{
              t(
                'This entry has no package or endpoint BasedCode can run. Use its documentation to add it manually.',
              )
            }}
          </p>
          <label v-else>{{ t('How to run it')
          }}<AppSelect
            v-model="optionId"
            :options="
              installing.options.map((item) => ({
                value: item.id,
                label: item.label,
              }))
            "
          /></label>
          <p
            v-if="option?.requirement"
            class="muted"
          >
            {{
              t(
                'Requires {runtime} on this computer. The package is downloaded the first time it starts.',
                { runtime: option.requirement },
              )
            }}
          </p>
          <div
            v-if="option"
            class="form-grid"
          >
            <label
              v-for="item in option.fields"
              :key="item.key"
              class="full-width"
            >{{ item.label }}{{ item.required ? ' *' : '' }}
              <AppSelect
                v-if="item.choices?.length"
                v-model="values[item.key]!"
                :options="item.choices.map((choice) => ({ value: choice, label: choice }))"
              />
              <input
                v-else
                v-model="values[item.key]"
                :type="item.secret ? 'password' : 'text'"
                autocomplete="off"
                spellcheck="false"
              >
              <small
                v-if="item.description"
                class="muted"
              >{{ item.description }}</small>
              <small
                v-if="item.secret"
                class="muted"
              ><KeyRound :size="11" />
                {{ t('Stored in the OS credential store, not in settings.') }}</small>
            </label>
            <label
              v-if="option.kind === 'remote'"
              class="full-width"
            >{{ t('Sign-in')
            }}<AppSelect
              v-model="authMode"
              :options="[
                {
                  value: 'auto',
                  label: t('Detect (OAuth when the server asks for it)'),
                },
                { value: 'oauth', label: t('OAuth sign-in') },
                { value: 'none', label: t('None / keys above') },
              ]"
            /></label>
          </div>
          <p
            v-if="installError"
            class="error-text"
            role="alert"
          >
            {{ installError }}
          </p>
          <footer class="modal-footer">
            <button
              type="button"
              class="secondary-button"
              @click="closeInstall"
            >
              {{ t('Cancel') }}
            </button>
            <button
              v-if="option"
              type="button"
              class="primary-button"
              :disabled="installBusy || missing.length > 0"
              :title="
                missing.length
                  ? t('Fill in: {fields}', {
                    fields: missing.map((item) => item.label).join(', '),
                  })
                  : ''
              "
              @click="install"
            >
              <LoaderCircle
                v-if="installBusy"
                :size="14"
                class="spin"
              /><Download
                v-else
                :size="14"
              />
              {{ t('Install') }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>

    <div
      class="mcp-results"
      :aria-busy="searching"
    >
      <article
        v-for="server in results"
        :key="server.name"
        class="provider-card mcp-result"
      >
        <header>
          <img
            v-if="server.icon"
            :src="server.icon"
            alt=""
            class="mcp-icon"
            referrerpolicy="no-referrer"
          >
          <div class="mcp-title">
            <strong>{{ server.title ?? server.name }}</strong>
            <small class="muted">{{ server.name }} · v{{ server.version }}</small>
          </div>
          <span class="spacer" />
          <span
            v-if="installedFrom(server)"
            class="saved-badge"
          ><CheckCircle2 :size="12" /> {{ t('Installed') }}</span>
          <button
            v-else
            class="secondary-button"
            @click="startInstall(server)"
          >
            <Download :size="14" /> {{ t('Install') }}
          </button>
        </header>
        <p>{{ server.description }}</p>
        <div class="mcp-tags">
          <span
            v-for="transport in transports(server)"
            :key="transport"
            class="mcp-tag"
          >{{
            transportLabel(transport)
          }}</span>
          <span
            v-for="requirement in [
              ...new Set(server.options.map((item) => item.requirement).filter(Boolean)),
            ]"
            :key="requirement"
            class="mcp-tag"
          >{{ requirement }}</span>
          <span
            v-if="!server.options.length"
            class="mcp-tag"
          >{{ t('Manual setup') }}</span>
          <span class="spacer" />
          <button
            v-if="server.repository"
            class="text-button"
            @click="openLink(server.repository)"
          >
            <ExternalLink :size="12" /> {{ t('Source') }}
          </button>
          <button
            v-if="server.website"
            class="text-button"
            @click="openLink(server.website)"
          >
            <ExternalLink :size="12" /> {{ t('Website') }}
          </button>
        </div>
      </article>
      <p
        v-if="!searching && !results.length && !browseError"
        class="muted"
      >
        {{ t('No servers found.') }}
      </p>
      <p
        v-if="searching"
        class="muted"
        role="status"
      >
        <LoaderCircle
          :size="14"
          class="spin"
        /> {{ t('Searching…') }}
      </p>
      <button
        v-if="nextCursor && !searching"
        class="secondary-button"
        @click="runSearch(true)"
      >
        {{ t('Load more') }}
      </button>
    </div>

    <McpRegistrySettings v-model="settings.mcpRegistries!" />
  </template>

  <KeepAlive>
    <InstalledMcpServers
      v-if="view === 'installed'"
      ref="installedServers"
      v-model:settings="settings"
      :workspace="workspace"
      @save="emit('save', $event)"
      @error="fail"
    />
  </KeepAlive>
</template>

<style scoped src="./mcpSettings.css"></style>
