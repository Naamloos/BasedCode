<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CheckCircle2, LoaderCircle, LogIn, LogOut, Plus, Trash2 } from '../../icons';
import type { GlobalSettings, McpServerStatus, ServerConfig, Workspace } from '../../../shared/types';
import { rpc } from '../../services/api';
import { confirmAction } from '../../state/dialogs';
import { t } from '../../theme/themes';
import AppSelect from '../common/AppSelect.vue';

const props = defineProps<{ workspace?: Workspace }>();
const settings = defineModel<GlobalSettings>('settings', { required: true });
const emit = defineEmits<{ save: [done: (ok: boolean) => void]; error: [message: string] }>();

function fail(failure: unknown) {
  emit('error', failure instanceof Error ? failure.message : String(failure));
}

function transportLabel(transport: ServerConfig['transport']) {
  return transport === 'stdio'
    ? t('Local stdio')
    : transport === 'sse'
      ? t('Remote SSE')
      : t('Remote HTTP');
}

// Installed servers.
const status = ref<Record<string, McpServerStatus>>({});
const expanded = ref('');
const busy = ref<Record<string, string>>({});
interface DiscoveredTool {
  name: string;
  description?: string;
}

const tools = ref<Record<string, DiscoveredTool[] | string>>({});
function discoveredTools(serverId: string): DiscoveredTool[] {
  const result = tools.value[serverId];
  return Array.isArray(result) ? result : [];
}
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

onMounted(() => void refreshStatus());

async function activate(server: ServerConfig) {
  expanded.value = server.id;
  await refreshStatus();
  if (server.auth === 'oauth') await signIn(server);
}

defineExpose({ activate });
</script>

<template>
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
            count: discoveredTools(server.id).length,
          })
        }}
      </p>
      <div
        v-for="tool in discoveredTools(server.id)"
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

<style scoped src="./mcpSettings.css"></style>
