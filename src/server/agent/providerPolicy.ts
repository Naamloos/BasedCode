/**
 * Codex features that give the model an operational path around BasedCode tools (checked against codex-cli 0.156.1).
 * Keep code_mode_host available: Codex uses it to dispatch the supplied MCP tools. Note: 0.156.1 ignores every way of
 * turning unified_exec off; shell_tool=false is what removes the native shell. The other layers are in AGENTS.md (Codex native tools).
 */
export const codexDisabledFeatures = [
  'shell_tool',
  'unified_exec',
  'unified_exec_tty',
  'shell_snapshot',
  'apps',
  'plugins',
  'remote_plugin',
  'plugin_sharing',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'in_app_browser',
  'computer_use',
  'image_generation',
  'view_image',
  'multi_agent',
  'hooks',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_suggest',
  'workspace_dependencies',
  'in_app_local_automation',
  'worktrees',
  'realtime_conversation',
];

/** Codex asking to run a native command or patch means it found a path around BasedCode tools: decline and flag it. */
export const nativeApproval = (kind: string, onViolation: (kind: string) => void) => async () => {
  onViolation(kind);
  return { decision: 'decline' as const };
};
