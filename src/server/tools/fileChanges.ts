import type { Languages } from '../integrations/languages.js';
import type { Events } from '../storage/events.js';
import type { ToolContext } from './definitions.js';

export function createFileNotifier(context: ToolContext, events: Events, languages: Languages) {
  const { workspace, run, signal } = context;
  /** Publishes the change and returns errors/warnings from an already-running language server, if any. */
  return async (path: string) => {
    events.publish('files-changed', { path }, workspace.id, run.id);
    try {
      await languages.changed(workspace, path);
    } catch (error) {
      events.publish(
        'notice',
        `File saved; language-server refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        workspace.id,
      );
    }
    const diagnostics = await languages.diagnosticsAfterWrite(workspace, path, signal);
    if (!diagnostics) return {};
    const problems = diagnostics.filter((item) => (item.severity ?? 1) <= 2);
    return {
      diagnostics: problems.slice(0, 20).map((item) => ({
        line: item.range.start.line + 1,
        severity: item.severity === 2 ? 'warning' : 'error',
        message: item.message.slice(0, 300),
      })),
      ...(problems.length > 20 ? { moreDiagnostics: problems.length - 20 } : {}),
    };
  };
}
