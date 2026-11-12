import type { ApprovalMode } from '../../shared/types';

export const approvalModes: Record<ApprovalMode, { name: string; detail: string }> = {
  always: {
    name: 'Always ask',
    detail: 'Every task, command, delete, install and external call waits for your approval.',
  },
  'per-tool': {
    name: 'Ask once per tool',
    detail:
      'The first use of each tool in a chat asks; its approval or denial is reused for that chat until the app restarts.',
  },
  'no-commands': {
    name: 'Edits only',
    detail:
      'The agent reads and edits files after task approval. Commands, deletes, installs and external MCP calls are refused without asking.',
  },
  'allow-all': {
    name: 'Allow everything',
    detail:
      'Nothing asks, including commands. Fallback consent you turned on still asks. Every automatic approval is recorded.',
  },
};
