import { computed, ref, watch, type Ref } from 'vue';
import hljs from 'highlight.js';
import type { AppState, Workspace } from '../../shared/types';
import { rpc } from '../services/api';

export function useWorkspaceDiagnostics(
  state: Ref<AppState>,
  workspace: Ref<Workspace | undefined>,
  workspaceId: Ref<string>,
  showDiagnostics: Ref<boolean>,
) {
  /** Use workspace-relative paths for local diagnostics and full paths for external files. */
  function diagnosticPath(uri: string): string {
    const path = decodeURIComponent(uri.replace(/^file:\/+/, '')).replaceAll('\\', '/');
    const root = workspace.value?.path.replaceAll('\\', '/').replace(/\/$/, '');
    return root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? path.slice(root.length + 1)
      : path;
  }
  const diagnosticList = computed(() =>
    state.value.diagnostics
      .filter((item) => insideWorkspace(item.uri))
      .map((item) => ({
        ...item,
        path: diagnosticPath(item.uri),
        level: (item.severity ?? 1) === 1 ? 'error' : item.severity === 2 ? 'warning' : 'info',
      }))
      .sort(
        (a, b) =>
          (a.severity ?? 1) - (b.severity ?? 1) ||
          a.path.localeCompare(b.path) ||
          a.range.start.line - b.range.start.line,
      ),
  );

  /** Diagnostics that point inside the open workspace; only these get snippets and an open-in-editor button. */
  const insideWorkspace = (uri: string) => {
    const root = workspace.value?.path.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    return (
      !!root &&
      decodeURIComponent(uri.replace(/^file:\/+/, ''))
        .replaceAll('\\', '/')
        .toLowerCase()
        .startsWith(`${root}/`)
    );
  };
  /** File lines by workspace path, for snippets; `null` while loading or when the file cannot be read as text. */
  const snippetSources = ref(new Map<string, string[] | null>());
  async function loadSnippetSources() {
    const target = workspaceId.value;
    const paths = [
      ...new Set(
        diagnosticList.value.filter((item) => insideWorkspace(item.uri)).map((item) => item.path),
      ),
    ].filter((path) => !snippetSources.value.has(path));
    for (const path of paths) snippetSources.value.set(path, null);
    await Promise.all(
      paths.map(async (path) => {
        try {
          const result = await rpc<{ content: string; binary: boolean }>('files.snippet', {
            workspaceId: target,
            path,
          });
          if (workspaceId.value === target && !result.binary)
            snippetSources.value.set(path, result.content.split(/\r?\n/));
        } catch {
          /* No snippet; the card still shows the message. */
        }
      }),
    );
    snippetSources.value = new Map(snippetSources.value);
  }
  watch(workspaceId, () => {
    snippetSources.value = new Map();
    if (showDiagnostics.value) void loadSnippetSources();
  });
  watch(
    () => [showDiagnostics.value, state.value.diagnostics] as const,
    ([open]) => {
      if (open) void loadSnippetSources();
    },
  );
  function highlightLine(code: string, path: string): string {
    const language = path.split('.').at(-1)?.toLowerCase() ?? '';
    const alias =
      (
        {
          vue: 'xml',
          mjs: 'javascript',
          cjs: 'javascript',
          mts: 'typescript',
          cts: 'typescript',
        } as Record<string, string>
      )[language] ?? language;
    return hljs.getLanguage(alias)
      ? hljs.highlight(code, { language: alias, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value;
  }
  /** Two lines of context around the reported range (at most six lines of the range itself), highlighted line by line. */
  function diagnosticSnippet(item: {
    path: string;
    range: { start: { line: number }; end: { line: number } };
  }) {
    const lines = snippetSources.value.get(item.path);
    if (!lines) return [];
    const from = Math.max(0, item.range.start.line - 2);
    const to = Math.min(
      lines.length - 1,
      Math.min(item.range.end.line, item.range.start.line + 5) + 2,
    );
    return lines.slice(from, to + 1).map((code, offset) => {
      const number = from + offset;
      return {
        number: number + 1,
        html: highlightLine(code.slice(0, 400), item.path) || ' ',
        hit: number >= item.range.start.line && number <= item.range.end.line,
      };
    });
  }
  function openDiagnosticInEditor(item: {
    path: string;
    range: { start: { line: number; character: number } };
  }) {
    return rpc('files.openExternal', {
      workspaceId: workspaceId.value,
      path: item.path,
      line: item.range.start.line + 1,
      column: item.range.start.character + 1,
    });
  }

  // Scan the whole workspace for problems whenever one is opened, so the Diagnostics page is filled without opening files.
  watch(
    workspaceId,
    (id) => {
      if (id) void rpc('language.scan', { workspaceId: id }).catch(() => undefined);
    },
    { immediate: true },
  );
  const scanningDiagnostics = ref(false);
  async function scanDiagnostics() {
    if (!workspaceId.value || scanningDiagnostics.value) return;
    scanningDiagnostics.value = true;
    try {
      await rpc('language.scan', { workspaceId: workspaceId.value, wait: true });
    } finally {
      scanningDiagnostics.value = false;
    }
  }

  function refreshSnippets() {
    snippetSources.value = new Map();
    void loadSnippetSources();
  }

  return {
    diagnosticList, insideWorkspace, diagnosticSnippet, openDiagnosticInEditor,
    scanningDiagnostics, scanDiagnostics, refreshSnippets,
  };
}
