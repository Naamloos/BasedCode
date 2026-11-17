import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { artifactTypes, type Artifact } from '../../shared/types.js';
import type { Store } from '../storage/store.js';
import type { DefineTool, ToolContext, ToolDefinition, ToolServices } from './definitions.js';

/** Largest artifact version. They live in the app database and are resent when read, so they stay document-sized. */
export const maxArtifactLength = 500_000;
/** Versions kept per artifact; the oldest go first. */
const maxVersions = 50;

/** An artifact as tools and the UI see it: the latest version's content plus the version count. */
export function artifactSummary(artifact: Artifact, version?: number) {
  const index = version === undefined ? artifact.versions.length - 1 : version - 1;
  const chosen = artifact.versions[index];
  if (!chosen) throw new Error(`Version ${version} does not exist; there are ${artifact.versions.length}.`);
  return {
    id: artifact.id,
    title: artifact.title,
    mediaType: artifact.mediaType,
    version: index + 1,
    versions: artifact.versions.length,
    updatedAt: chosen.createdAt,
    content: chosen.content,
  };
}

/** Live artifacts of a workspace, newest first. */
export function workspaceArtifacts(store: Store, workspaceId: string): Artifact[] {
  return store
    .all('artifact')
    .filter((artifact) => artifact.workspaceId === workspaceId && !artifact.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Artifacts: documents the agent writes and revises in the app database rather than the workspace: reports, plans,
 * HTML pages, data. Every update keeps the previous version, so nothing the agent wrote is lost, and none of it
 * touches the user's files, so no approval or checkpoint is needed.
 */
export function createArtifactTools(
  context: ToolContext,
  services: Pick<ToolServices, 'store' | 'events'>,
  definition: DefineTool,
): ToolDefinition[] {
  const { store, events } = services;
  const { workspace, run } = context;
  const find = (id: string) => {
    const artifact = store.all('artifact').find((item) => item.id === id);
    if (!artifact || artifact.deletedAt || artifact.workspaceId !== workspace.id)
      throw new Error('No artifact with that id in this workspace. See artifact_list.');
    return artifact;
  };
  const content = z.string().max(maxArtifactLength);

  return [
    definition(
      'artifact_create',
      'Create an artifact: a document shown to the user in the chat and kept with this workspace, outside its files. Use it for reports, plans, HTML pages or dashboards, data tables and diagrams the user should read or keep, rather than writing such files into the project. text/html renders in a sandboxed frame without network access. Every later update is kept as a new version.',
      {
        title: z.string().trim().min(1).max(120),
        mediaType: z.enum(artifactTypes).default('text/markdown'),
        content,
      },
      async ({ title, mediaType, content: text }) => {
        const now = new Date().toISOString();
        const artifact = store.put('artifact', {
          id: randomUUID(),
          workspaceId: workspace.id,
          chatId: run.chatId,
          title,
          mediaType,
          versions: [{ content: text, createdAt: now, runId: run.id }],
          createdAt: now,
          updatedAt: now,
        });
        events.publish('state');
        return { id: artifact.id, title, version: 1 };
      },
    ),
    definition(
      'artifact_update',
      'Write a new version of an artifact. Give the full new content, or edits (exact text replacements applied to the latest version) for a small change. The previous version is kept.',
      {
        id: z.string().min(1),
        content: content.optional().describe('The complete new content.'),
        edits: z
          .array(z.object({ find: z.string().min(1), replace: z.string() }))
          .max(50)
          .optional()
          .describe('Replacements; each find must occur exactly once.'),
        title: z.string().trim().min(1).max(120).optional(),
        note: z.string().max(200).optional().describe('What changed, shown with the version.'),
      },
      async ({ id, content: text, edits, title, note }) => {
        if ((text === undefined) === (edits === undefined)) throw new Error('Give either content or edits.');
        const artifact = find(id);
        let next = text ?? artifact.versions.at(-1)!.content;
        for (const edit of edits ?? []) {
          const count = next.split(edit.find).length - 1;
          if (count !== 1) throw new Error(`"${edit.find.slice(0, 60)}" occurs ${count} times; it must occur once.`);
          next = next.replace(edit.find, () => edit.replace);
        }
        if (next.length > maxArtifactLength) throw new Error(`An artifact holds at most ${maxArtifactLength} characters.`);
        const now = new Date().toISOString();
        const versions = [...artifact.versions, { content: next, createdAt: now, runId: run.id, note }].slice(-maxVersions);
        store.put('artifact', { ...artifact, title: title ?? artifact.title, versions, updatedAt: now });
        events.publish('state');
        return { id, title: title ?? artifact.title, version: versions.length };
      },
    ),
    definition(
      'artifact_read',
      "Read an artifact's latest version, or an earlier one.",
      {
        id: z.string().min(1),
        version: z.number().int().min(1).optional().describe('1 is the oldest kept version.'),
      },
      async ({ id, version }) => artifactSummary(find(id), version),
    ),
    definition(
      'artifact_list',
      "List this workspace's artifacts, newest first, without their content.",
      {},
      async () =>
        workspaceArtifacts(store, workspace.id).map((artifact) => ({
          ...artifactSummary(artifact),
          content: undefined,
          fromThisChat: artifact.chatId === run.chatId,
        })),
    ),
    definition(
      'artifact_delete',
      'Delete an artifact and all its versions. Only when the user asks.',
      { id: z.string().min(1) },
      async ({ id }) => {
        const artifact = find(id);
        store.put('artifact', { ...artifact, deletedAt: new Date().toISOString() });
        events.publish('state');
        return { deleted: id };
      },
    ),
  ];
}
