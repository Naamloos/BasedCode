import { EventEmitter } from 'node:events';
import type { AppEvent } from '../../shared/types.js';

export class Events extends EventEmitter {
  private readonly browsers = new Map<string, () => Promise<void>>();

  async registerBrowser(chatId: string, close: () => Promise<void>): Promise<void> {
    await this.closeBrowser(chatId);
    this.browsers.set(chatId, close);
  }

  async closeBrowser(chatId: string): Promise<void> {
    const close = this.browsers.get(chatId);
    this.browsers.delete(chatId);
    await close?.();
  }

  publish(type: string, data: unknown = null, workspaceId?: string, runId?: string): void {
    this.emit('event', { type, data, workspaceId, runId } satisfies AppEvent);
  }

  /** A live browser frame (JPEG). Binary and up to tens per second, so it bypasses the app event stream. */
  frame(chatId: string, image: Buffer): void {
    this.emit('frame', chatId, image);
  }

  /** The chat's browser closed: live streams end on their last frame. */
  frameEnd(chatId: string): void {
    this.emit('frame-end', chatId);
  }
}
