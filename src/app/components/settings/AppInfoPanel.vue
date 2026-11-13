<script setup lang="ts">
import { ref } from 'vue';
import { Coins, ExternalLink, Globe, LoaderCircle } from '../../icons';
import { rpc } from '../../services/api';
import { installUpdate, updating as installingUpdate } from '../../state/updates';
import { t } from '../../theme/themes';
import packageJson from '../../../../package.json';

const appIcon = new URL('../../assets/icon.png', import.meta.url).href;

const appVersion = ref('');
const checkingUpdate = ref(false);
const updateAvailable = ref(false);
const updateStatus = ref('');

rpc<{ current: string }>('update.check')
  .then((info) => (appVersion.value = info.current))
  .catch(() => (appVersion.value = '?'));

async function checkForUpdates() {
  if (checkingUpdate.value) return;
  checkingUpdate.value = true;
  updateStatus.value = '';
  try {
    const info = await rpc<{ current: string; supported: boolean; available: boolean; latest?: string; error?: string }>('update.check');
    appVersion.value = info.current;
    updateAvailable.value = info.supported && info.available && !info.error;
    updateStatus.value = updateMessage(info);
  } catch (error) {
    updateStatus.value = error instanceof Error ? error.message : String(error);
  } finally {
    checkingUpdate.value = false;
  }
}

function updateMessage(info: { supported: boolean; available: boolean; latest?: string; error?: string }): string {
  if (info.error) return info.error;
  if (!info.supported) return t('Automatic updates are only available in the installed Windows app.');
  if (info.available) return t('Version {version} is available.', { version: info.latest ?? '' });
  return t('You are up to date.');
}

const infoLinks = [
  { label: 'BasedCode on GitHub', url: 'https://github.com/naamloos/basedcode', icon: ExternalLink },
  { label: 'Donate (Ko-fi)', url: 'https://ko-fi.com/naamloos', icon: Coins },
  { label: 'Main Developer', url: 'https://naamloos.dev', icon: Globe },
  { label: 'License', url: 'https://github.com/naamloos/basedcode/blob/HEAD/LICENSE', icon: ExternalLink },
];

function openLink(url: string) {
  void rpc('external.open', { url });
}

// Credits come straight from package.json, so they stay current as dependencies change.
// Versions are the ranges package.json asks for, shown without the ^/~ prefix.
function creditList(packages: Record<string, string>) {
  return Object.entries(packages)
    .map(([name, range]) => ({ name, version: range.replace(/^[\^~]/, '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const creditGroups = [
  { title: 'Used by the app', packages: creditList(packageJson.dependencies) },
  { title: 'Development tools', packages: creditList(packageJson.devDependencies) },
];
</script>

<template>
  <div class="settings-info">
    <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center">
      <img
        :src="appIcon"
        alt="BasedCode"
        width="72"
        height="72"
      >
      <strong style="font-size: 1.3em">BasedCode</strong>
      <span class="muted">{{ t('Version') }} {{ appVersion || '…' }}</span>
      <button
        class="secondary-button"
        :disabled="checkingUpdate || installingUpdate"
        @click="checkForUpdates"
      >
        <LoaderCircle
          v-if="checkingUpdate"
          :size="14"
        />
        {{ checkingUpdate ? t('Checking for updates…') : t('Check for updates') }}
      </button>
      <button
        v-if="updateAvailable"
        class="secondary-button"
        :disabled="installingUpdate || checkingUpdate"
        @click="installUpdate"
      >
        {{ installingUpdate ? t('Updating…') : t('Install update and restart') }}
      </button>
      <span
        v-if="updateStatus"
        class="muted small"
        role="status"
      >{{ updateStatus }}</span>
    </div>
    <div
      style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: min(100%, 380px); margin: 20px auto 0"
    >
      <button
        v-for="link in infoLinks"
        :key="link.url"
        class="secondary-button"
        style="justify-content: center"
        :title="link.url"
        @click="openLink(link.url)"
      >
        <component
          :is="link.icon"
          :size="14"
        /> {{ t(link.label) }}
      </button>
    </div>
    <div class="package-credits">
      <h4>{{ t('Built with') }}</h4>
      <p class="muted small">
        {{ t('BasedCode stands on these open source packages.') }}
      </p>
      <section
        v-for="group in creditGroups"
        :key="group.title"
        class="package-credit-group"
      >
        <h5>{{ t(group.title) }} <span class="muted">({{ group.packages.length }})</span></h5>
        <ul class="package-credit-list">
          <li
            v-for="item in group.packages"
            :key="item.name"
          >
            <button
              class="package-credit"
              :title="`https://www.npmjs.com/package/${item.name}`"
              @click="openLink(`https://www.npmjs.com/package/${item.name}`)"
            >
              {{ item.name }}
            </button>
            <span class="package-credit-version">{{ item.version }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
