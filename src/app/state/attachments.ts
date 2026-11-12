import { ref } from 'vue';
import type { Attachment } from '../../shared/types';
import { attachmentUrl, rpc } from '../services/api';
import { t } from '../theme/themes';

/** What the preview needs: a local File before upload, or the backend URL after. */
export interface PreviewItem {
  name: string;
  mediaType: string;
  size: number;
  url?: string;
  file?: File;
}

export interface PendingAttachment {
  key: string;
  file: File;
  url?: string;
  attachment?: Attachment;
  error?: string;
}

const attachmentCountLimit = 20;
const attachmentSizeLimit = 20 * 1024 * 1024;

export function useAttachments(report: (failure: unknown) => void) {
  /** Files attached in the composer: uploaded as soon as they are added, sent with the next prompt. */

  const pending = ref<PendingAttachment[]>([]);
  const attachmentPreview = ref<PreviewItem>();
  const dragging = ref(false);
  function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error ?? new Error(t('Could not read the file.')));
      reader.readAsDataURL(file);
    });
  }
  async function addFiles(files: Iterable<File>) {
    for (const file of files) {
      if (pending.value.length >= attachmentCountLimit) {
        report(t('Up to 20 attachments per prompt.'));
        break;
      }
      const item: PendingAttachment = {
        key: crypto.randomUUID(),
        file,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      };
      if (file.size > attachmentSizeLimit) item.error = t('Larger than 20 MB');
      pending.value.push(item);
      if (item.error) continue;
      const entry = pending.value.at(-1)!;
      // Pasted screenshots arrive as "image.png"; give them a findable name.
      const name =
        file.name && file.name !== 'image.png'
          ? file.name
          : `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.${file.type.split('/')[1] ?? 'bin'}`;
      try {
        entry.attachment = await rpc<Attachment>('attachment.upload', {
          name,
          mediaType: file.type || 'application/octet-stream',
          data: await readBase64(file),
        });
      } catch (failure) {
        entry.error = failure instanceof Error ? failure.message : String(failure);
      }
    }
  }
  function removeAttachment(key: string) {
    const item = pending.value.find((entry) => entry.key === key);
    if (item?.url) URL.revokeObjectURL(item.url);
    pending.value = pending.value.filter((entry) => entry.key !== key);
  }
  function pasteFiles(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  }
  function dropFiles(event: DragEvent) {
    dragging.value = false;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) void addFiles(files);
  }
  async function previewPending(item: PendingAttachment) {
    attachmentPreview.value = {
      name: item.attachment?.name ?? item.file.name,
      mediaType: item.file.type || 'application/octet-stream',
      size: item.file.size,
      url: item.url ?? (item.attachment ? attachmentUrl(item.attachment.id) : undefined),
      file: item.file,
    };
  }
  function previewSent(attachment: Attachment) {
    attachmentPreview.value = {
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
      url: attachmentUrl(attachment.id),
    };
  }

  return {
    pending,
    attachmentPreview,
    dragging,
    addFiles,
    removeAttachment,
    pasteFiles,
    dropFiles,
    previewPending,
    previewSent,
  };
}
