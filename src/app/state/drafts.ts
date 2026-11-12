/** Unsent composer text per chat, kept in localStorage so it survives chat switches and app restarts. */
const prefix = 'basedcode.draft.';
const maxLength = 200_000;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadDraft(chatId: string, storage: DraftStorage = localStorage): string {
  return chatId ? (storage.getItem(prefix + chatId) ?? '') : '';
}

export function saveDraft(
  chatId: string,
  text: string,
  storage: DraftStorage = localStorage,
): void {
  if (!chatId) return;
  try {
    if (text.trim()) storage.setItem(prefix + chatId, text.slice(0, maxLength));
    else storage.removeItem(prefix + chatId);
  } catch {
    /* Quota exceeded: a lost draft is not worth breaking the composer for. */
  }
}

export function clearDraft(chatId: string, storage: DraftStorage = localStorage): void {
  if (chatId) storage.removeItem(prefix + chatId);
}
