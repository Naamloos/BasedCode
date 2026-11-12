import { ref } from 'vue';
import type { AppLanguage } from '../../shared/types';
import type { Dictionary } from '../locales/types';
import nl from '../locales/nl';
import based from '../locales/based';

/**
 * UI translations keyed by the English source text. Missing keys fall back to English, so English needs no table.
 * `{name}`-style placeholders are filled from the params passed to `t`.
 * Model output, user content, file paths and provider/model names are never translated.
 */

const translations: Record<AppLanguage, Dictionary> = { en: {}, nl, based };

export const appLanguage = ref<AppLanguage>('en');
export function setAppLanguage(language: AppLanguage | undefined): void {
  appLanguage.value = language && language in translations ? language : 'en';
}

/** Translates English UI text into the current language and fills `{name}` placeholders from `params`. */
export function t(text: string, params?: Record<string, string | number>): string {
  const translated = translations[appLanguage.value][text] ?? text;
  if (!params) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}
