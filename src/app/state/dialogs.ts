import { shallowRef } from 'vue';
import { t } from '../theme/i18n';

interface Confirmation {
  title: string;
  detail: string;
  accept: string;
  resolve: (approved: boolean) => void;
}

export const confirmation = shallowRef<Confirmation>();
const pending: Confirmation[] = [];

export function confirmAction(
  title: string,
  detail: string,
  accept = t('Confirm'),
): Promise<boolean> {
  return new Promise((resolve) => {
    pending.push({ title, detail, accept, resolve });
    confirmation.value ??= pending.shift();
  });
}

export function decideConfirmation(approved: boolean): void {
  confirmation.value?.resolve(approved);
  confirmation.value = pending.shift();
}
