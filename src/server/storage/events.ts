import { EventEmitter } from 'node:events';
import type { AppEvent } from '../../shared/types.js';

export class Events extends EventEmitter {
  publish(type: string, data: unknown = null, workspaceId?: string, runId?: string): void {
    this.emit('event', { type, data, workspaceId, runId } satisfies AppEvent);
  }
}
