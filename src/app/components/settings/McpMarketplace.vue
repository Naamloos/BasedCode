<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  Plug,
  Plus,
  Search,
  Trash2,
  X,
} from '../../icons';
import {
  defaultMcpRegistries,
  type GlobalSettings,
  type McpInstallOption,
  type McpRegistryServer,
  type McpServerStatus,
  type ServerConfig,
  type Workspace,
} from '../../../shared/types';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { t } from '../../theme/themes';
import AppSelect from '../common/AppSelect.vue';

/**
 * App-wide MCP servers: browse registries, install with generated fields, and manage what is installed.
 * Server configs live in `settings.mcpServers` (saved with the panel); secrets and sign-ins go straight to the
 * backend credential store and never enter settings.
 */
const props = defineProps<{ workspace?: Workspace }>();
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
  void refreshStatus();
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
    expanded.value = config.id;
    await refreshStatus();
    if (config.auth === 'oauth') await signIn(config);
  } catch (failure) {
    installError.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    installBusy.value = false;
  }
}

// Installed servers.
const status = ref<Record<string, McpServerStatus>>({});
const expanded = ref('');
const busy = ref<Record<string, string>>({});
const tools = ref<Record<string, { name: string; description?: string }[] | string>>({});
const secretDrafts = ref<Record<string, string>>({});
const newSecret = ref<Record<string, { kind: 'env' | 'header'; name: string }>>({});

async function refreshStatus() {
  try {
    status.value = await rpc<Record<string, McpServerStatus>>('mcp.status', {});
  } catch (failure) {
    fail(failure);
  }
}
function save(): Promise<boolean> {
  return new Promise((resolve) => emit('save', resolve));
}
function secretNames(server: ServerConfig) {
  return [
    ...(server.secretEnv ?? []).map((name) => ({
      key: `env.${name}`,
      label: name,
      kind: t('Environment'),
    })),
    ...(server.secretHeaders ?? []).map((name) => ({
      key: `header.${name}`,
      label: name,
      kind: t('Header'),
    })),
  ];
}
function hasSecret(server: ServerConfig, key: string) {
  return status.value[server.id]?.savedSecrets.includes(key) ?? false;
}
async function saveSecret(server: ServerConfig, key: string) {
  const draftKey = `${server.id}:${key}`;
  try {
    await rpc('mcp.secret', {
      serverId: server.id,
      name: key,
      value: secretDrafts.value[draftKey] ?? '',
    });
    delete secretDrafts.value[draftKey];
    await refreshStatus();
  } catch (failure) {
    fail(failure);
  }
}
async function addSecret(server: ServerConfig) {
  const draft = newSecret.value[server.id];
  const name = draft?.name.trim() ?? '';
  const valid = draft?.kind === 'header' ? /^[A-Za-z0-9-]+$/ : /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!draft || !valid.test(name)) {
    emit('error', t('Use letters, digits, - or _ for the name.'));
    return;
  }
  const list = draft.kind === 'env' ? (server.secretEnv ??= []) : (server.secretHeaders ??= []);
  if (!list.includes(name)) list.push(name);
  newSecret.value[server.id] = { kind: draft.kind, name: '' };
  await save();
}
async function removeSecret(server: ServerConfig, key: string) {
  const [kind, name] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)];
  if (kind === 'env') server.secretEnv = server.secretEnv?.filter((item) => item !== name);
  else server.secretHeaders = server.secretHeaders?.filter((item) => item !== name);
  await rpc('mcp.secret', { serverId: server.id, name: key, value: '' }).catch(fail);
  await save();
  await refreshStatus();
}

async function signIn(server: ServerConfig) {
  busy.value[server.id] = 'signin';
  try {
    if (!(await save())) return;
    await rpc('mcp.oauth.signIn', { serverId: server.id });
    await refreshStatus();
  } catch (failure) {
    fail(failure);
  } finally {
    delete busy.value[server.id];
  }
}
async function signOut(server: ServerConfig) {
  await rpc('mcp.oauth.signOut', { serverId: server.id }).catch(fail);
  await refreshStatus();
}

async function test(server: ServerConfig) {
  if (!props.workspace) return;
  busy.value[server.id] = 'test';
  delete tools.value[server.id];
  try {
    if (!(await save())) return;
    const catalog = await rpc<{
      tools: { name: string; description?: string }[];
    }>('mcp.discover', {
      workspaceId: props.workspace.id,
      serverId: server.id,
    });
    tools.value[server.id] = catalog.tools.map(({ name, description }) => ({
      name,
      description,
    }));
  } catch (failure) {
    tools.value[server.id] = failure instanceof Error ? failure.message : String(failure);
  } finally {
    delete busy.value[server.id];
  }
}

async function remove(index: number) {
  const server = settings.value.mcpServers[index]!;
  if (
    !(await confirmAction(
      t('Remove {name}?', { name: server.name }),
      t('Its saved keys and sign-in are deleted too. Agents can no longer use it.'),
      t('Remove server'),
    ))
  )
    return;
  settings.value.mcpServers.splice(index, 1);
  await save();
  await refreshStatus();
}
function toggle(server: ServerConfig, enabled: boolean) {
  server.enabled = enabled;
  void save();
}
function addManual() {
  const server: ServerConfig = {
    id: crypto.randomUUID(),
    name: t('New server'),
    transport: 'stdio',
    command: '',
    args: [],
    enabled: true,
  };
  settings.value.mcpServers.push(server);
  expanded.value = server.id;
}
function setPairs(server: ServerConfig, field: 'env' | 'headers', text: string) {
  const pairs = Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.split(/=(.*)/s).map((part) => part.trim()))
      .filter(([key]) => key),
  ) as Record<string, string>;
  server[field] = Object.keys(pairs).length ? pairs : undefined;
}
const pairsText = (pairs?: Record<string, string>) =>
  Object.entries(pairs ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

function restoreRegistries() {
  settings.value.mcpRegistries = structuredClone(defaultMcpRegistries);
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

  <template v-else>
    <p
      v-if="!settings.mcpServers.length"
      class="muted"
    >
      {{ t('Nothing installed yet. Find servers in the Marketplace.') }}
    </p>
    <p
      v-if="!workspace"
      class="muted"
    >
      {{ t('Open a workspace to test connections.') }}
    </p>
    <article
      v-for="(server, index) in settings.mcpServers"
      :key="server.id"
      class="provider-card"
      :class="{ inherited: server.enabled === false }"
    >
      <header>
        <input
          class="switch"
          type="checkbox"
          role="switch"
          :checked="server.enabled !== false"
          :aria-label="t('Enable {name}', { name: server.name })"
          @change="toggle(server, ($event.target as HTMLInputElement).checked)"
        >
        <button
          class="text-button mcp-name"
          @click="expanded = expanded === server.id ? '' : server.id"
        >
          <strong>{{ server.name || t('New server') }}</strong>
        </button>
        <span class="mcp-tag">{{ transportLabel(server.transport) }}</span>
        <span
          v-if="server.auth === 'oauth'"
          class="mcp-tag"
          :class="{ ok: status[server.id]?.signedIn }"
        >
          {{ status[server.id]?.signedIn ? t('Signed in') : t('Sign-in needed') }}
        </span>
        <span class="spacer" />
        <button
          class="icon-button"
          :title="t('Remove server')"
          @click="remove(index)"
        >
          <Trash2 :size="14" />
        </button>
      </header>
      <p
        v-if="server.description"
        class="muted"
      >
        {{ server.description }}
      </p>

      <template v-if="expanded === server.id">
        <div class="form-grid">
          <label>{{ t('Name') }}<input
            v-model="server.name"
            autocomplete="off"
          ></label>
          <label>{{ t('Transport')
          }}<AppSelect
            v-model="server.transport"
            :options="[
              { value: 'stdio', label: t('Local stdio') },
              { value: 'http', label: t('Remote HTTP') },
              { value: 'sse', label: t('Remote SSE') },
            ]"
          /></label>
          <template v-if="server.transport === 'stdio'">
            <label class="full-width">{{ t('Executable')
            }}<input
              v-model="server.command"
              autocomplete="off"
              placeholder="npx"
            ></label>
            <label class="full-width">{{ t('Arguments · one per line')
            }}<textarea
              :value="(server.args ?? []).join('\n')"
              rows="3"
              autocomplete="off"
              spellcheck="false"
              @input="
                server.args = ($event.target as HTMLTextAreaElement).value
                  .split('\n')
                  .filter(Boolean)
              "
            />
            </label>
            <label class="full-width">{{ t('Environment · NAME=value per line (not secret)')
            }}<textarea
              :value="pairsText(server.env)"
              rows="2"
              autocomplete="off"
              spellcheck="false"
              @change="setPairs(server, 'env', ($event.target as HTMLTextAreaElement).value)"
            />
            </label>
          </template>
          <template v-else>
            <label class="full-width">URL<input
              v-model="server.url"
              autocomplete="off"
              placeholder="https://example.com/mcp"
            ></label>
            <label class="full-width">{{ t('Headers · Name=value per line (not secret)')
            }}<textarea
              :value="pairsText(server.headers)"
              rows="2"
              autocomplete="off"
              spellcheck="false"
              @change="setPairs(server, 'headers', ($event.target as HTMLTextAreaElement).value)"
            />
            </label>
            <label>{{ t('Sign-in')
            }}<AppSelect
              :model-value="server.auth ?? 'none'"
              :options="[
                { value: 'none', label: t('None / keys') },
                { value: 'oauth', label: t('OAuth sign-in') },
              ]"
              @update:model-value="server.auth = $event as 'none' | 'oauth'"
            /></label>
          </template>
        </div>

        <div
          v-if="server.transport !== 'stdio' && server.auth === 'oauth'"
          class="mcp-oauth"
        >
          <div class="form-grid">
            <label>{{ t('Client ID (optional)')
            }}<input
              :value="server.oauth?.clientId ?? ''"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('Registered automatically when empty')"
              @input="
                server.oauth = {
                  ...server.oauth,
                  clientId: ($event.target as HTMLInputElement).value || undefined,
                }
              "
            ></label>
            <label>{{ t('Scopes (optional)')
            }}<input
              :value="server.oauth?.scopes ?? ''"
              autocomplete="off"
              spellcheck="false"
              @input="
                server.oauth = {
                  ...server.oauth,
                  scopes: ($event.target as HTMLInputElement).value || undefined,
                }
              "
            ></label>
            <label
              v-if="server.oauth?.clientId"
              class="full-width"
            >{{ t('Client secret (optional)') }}
              <span class="mcp-secret">
                <input
                  v-model="secretDrafts[`${server.id}:oauthClientSecret`]"
                  type="password"
                  autocomplete="off"
                  :placeholder="
                    hasSecret(server, 'oauthClientSecret') ? t('Saved · type to replace') : ''
                  "
                >
                <button
                  class="secondary-button"
                  @click="saveSecret(server, 'oauthClientSecret')"
                >
                  {{ t('Save') }}
                </button>
              </span>
            </label>
          </div>
          <p class="muted">
            {{
              t(
                'Using your own OAuth app? Register {url} as its callback URL (any port on 127.0.0.1).',
                { url: 'http://127.0.0.1/oauth/mcp/callback' },
              )
            }}
          </p>
          <button
            v-if="!status[server.id]?.signedIn"
            class="primary-button"
            :disabled="busy[server.id] === 'signin'"
            @click="signIn(server)"
          >
            <LoaderCircle
              v-if="busy[server.id] === 'signin'"
              :size="14"
              class="spin"
            /><LogIn
              v-else
              :size="14"
            />
            {{ busy[server.id] === 'signin' ? t('Waiting for the browser…') : t('Sign in') }}
          </button>
          <button
            v-else
            class="secondary-button"
            @click="signOut(server)"
          >
            <LogOut :size="14" /> {{ t('Sign out') }}
          </button>
        </div>

        <h4>{{ t('Keys & tokens') }}</h4>
        <div
          v-for="secret in secretNames(server)"
          :key="secret.key"
          class="mcp-secret"
        >
          <span class="mcp-tag">{{ secret.kind }}</span>
          <code>{{ secret.label }}</code>
          <input
            v-model="secretDrafts[`${server.id}:${secret.key}`]"
            type="password"
            autocomplete="off"
            :aria-label="secret.label"
            :placeholder="
              hasSecret(server, secret.key) ? t('Saved · type to replace') : t('Not set')
            "
          >
          <button
            class="secondary-button"
            @click="saveSecret(server, secret.key)"
          >
            {{ t('Save') }}
          </button>
          <button
            class="icon-button"
            :title="t('Remove')"
            @click="removeSecret(server, secret.key)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
        <div class="mcp-secret">
          <AppSelect
            :model-value="
              newSecret[server.id]?.kind ?? (server.transport === 'stdio' ? 'env' : 'header')
            "
            :options="[
              { value: 'env', label: t('Environment') },
              { value: 'header', label: t('Header') },
            ]"
            @update:model-value="
              newSecret[server.id] = {
                kind: $event as 'env' | 'header',
                name: newSecret[server.id]?.name ?? '',
              }
            "
          />
          <input
            :value="newSecret[server.id]?.name ?? ''"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('Name, e.g. API_KEY or Authorization')"
            @input="
              newSecret[server.id] = {
                kind:
                  newSecret[server.id]?.kind ?? (server.transport === 'stdio' ? 'env' : 'header'),
                name: ($event.target as HTMLInputElement).value,
              }
            "
          >
          <button
            class="secondary-button"
            @click="addSecret(server)"
          >
            <Plus :size="14" /> {{ t('Add key') }}
          </button>
        </div>
      </template>

      <div class="mcp-actions">
        <button
          class="secondary-button"
          :disabled="!workspace || server.enabled === false || Boolean(busy[server.id])"
          @click="test(server)"
        >
          <LoaderCircle
            v-if="busy[server.id] === 'test'"
            :size="14"
            class="spin"
          />
          {{ t('Test connection') }}
        </button>
        <button
          v-if="expanded !== server.id"
          class="text-button"
          @click="expanded = server.id"
        >
          {{ t('Configure') }}
        </button>
      </div>
      <p
        v-if="typeof tools[server.id] === 'string'"
        class="error-text"
        role="alert"
      >
        {{ tools[server.id] }}
      </p>
      <div
        v-else-if="tools[server.id]"
        class="mcp-tools"
      >
        <p class="muted">
          <CheckCircle2 :size="12" />
          {{
            t('Connected · {count} tool(s)', {
              count: (tools[server.id] as []).length,
            })
          }}
        </p>
        <div
          v-for="tool in tools[server.id] as {
            name: string;
            description?: string;
          }[]"
          :key="tool.name"
          class="tool-option"
        >
          <span class="tool-option-text"><code>{{ tool.name }}</code><small>{{ tool.description }}</small></span>
        </div>
      </div>
    </article>
    <button
      class="secondary-button"
      @click="addManual"
    >
      <Plus :size="14" /> {{ t('Add server manually') }}
    </button>
  </template>
</template>

<style scoped>
.mcp-views {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.mcp-views button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border, transparent);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.mcp-views button.active {
  background: var(--surface-strong, rgba(127, 127, 127, 0.16));
}
.mcp-search {
  display: grid;
  grid-template-columns: minmax(140px, 220px) 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.mcp-results {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}
.mcp-result p {
  margin: 6px 0;
}
/* Denser than the default settings cards: these lists get long. */
.provider-card {
  margin: 6px 0;
  padding: 10px 12px;
}
.provider-card > header {
  margin-bottom: 6px;
}
.mcp-results .provider-card {
  margin: 0;
}
.mcp-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  flex: none;
}
.mcp-title {
  display: grid;
  min-width: 0;
}
.mcp-title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcp-tags,
.mcp-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.mcp-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-strong, rgba(127, 127, 127, 0.16));
  white-space: nowrap;
}
.mcp-tag.ok {
  color: var(--success, #2e9d5b);
}
.mcp-name {
  padding: 0;
}
.mcp-registry,
.mcp-secret {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}
.mcp-registry input:not(.switch),
.mcp-secret input {
  flex: 1;
  min-width: 0;
}
.mcp-oauth {
  display: grid;
  gap: 8px;
  margin: 8px 0;
}
/* Above the settings modal, which uses the same backdrop. */
.mcp-install-backdrop {
  z-index: 30;
}
.mcp-install {
  width: 560px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mcp-install .modal-header {
  padding-bottom: 0;
}
.mcp-install .modal-header h2 {
  font-size: 16px;
  overflow-wrap: anywhere;
}
.mcp-install > p {
  margin: 0;
}
.mcp-install .form-grid {
  margin-top: 4px;
}
/* Clear space between the last field and the actions. */
.mcp-install .modal-footer {
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.mcp-tools {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}
small.muted {
  display: block;
}
@media (max-width: 640px) {
  .mcp-search {
    grid-template-columns: 1fr;
  }
}
</style>
