import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import type { Workspace } from "../../shared/types.js";
import { fileTree, readText } from "../workspace/workspace.js";

export const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const maxSkillLength = 50_000;
/** Skill folder families in lookup order; BasedCode's own comes first and is where new skills go by default. */
export const skillSources = ["basedcode", "claude", "codex", "agents"] as const;
export type SkillSource = (typeof skillSources)[number];
export type SkillScope = "workspace" | "global";
const sourceFolder = (source: SkillSource) => `.${source}/skills`;

export interface Skill {
  name: string;
  scope: SkillScope;
  source: SkillSource;
  /** Workspace-relative for workspace skills, absolute for global ones. */
  path: string;
  content: string;
}

const validName = (name: string) => skillNamePattern.test(name) && name.length <= 64;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Global skill folders in lookup order; the first is where new global skills are written. */
export function globalSkillRoots(home = homedir()) {
  return skillSources.map((source) => join(home, `.${source}`, "skills"));
}

async function workspaceSkills(workspace: Workspace, source: SkillSource): Promise<Skill[]> {
  const root = sourceFolder(source);
  let entries;
  try {
    entries = await fileTree(workspace, root);
  } catch (error) {
    // Folders outside the workspace boundary (or unreadable ones) simply have no skills to offer.
    if (missing(error) || source !== "basedcode") return [];
    throw error;
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.directory || !validName(entry.name)) continue;
    const path = `${root}/${entry.name}/SKILL.md`;
    try {
      const { content, binary } = await readText(workspace, path);
      if (!binary && content.length <= maxSkillLength)
        skills.push({ name: entry.name, scope: "workspace", source, path, content });
    } catch (error) {
      if (!missing(error) && source === "basedcode") throw error;
    }
  }
  return skills;
}

async function globalSkills(source: SkillSource, home = homedir()): Promise<Skill[]> {
  const root = join(home, `.${source}`, "skills");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!(entry.isDirectory() || entry.isSymbolicLink()) || !validName(entry.name)) continue;
    const path = join(root, entry.name, "SKILL.md");
    try {
      const content = await readFile(path, "utf8");
      if (!content.includes("\0") && content.length <= maxSkillLength)
        skills.push({ name: entry.name, scope: "global", source, path, content });
    } catch {
      // Not a skill folder (or unreadable): skip it like a folder without SKILL.md.
    }
  }
  return skills;
}

/**
 * Every skill in every folder, in lookup order: workspace folders first, then global ones, each in `skillSources`
 * order. Names can repeat; the first one wins (see listSkills).
 */
export async function listAllSkills(workspace: Workspace | undefined, home = homedir()): Promise<Skill[]> {
  const found: Skill[][] = [];
  if (workspace) for (const source of skillSources) found.push(await workspaceSkills(workspace, source));
  for (const source of skillSources) found.push(await globalSkills(source, home));
  return found.flat();
}

/** Every skill by name; a workspace skill shadows a global one, earlier folders shadow later ones. */
export async function listSkills(workspace: Workspace): Promise<Skill[]> {
  const byName = new Map<string, Skill>();
  for (const skill of await listAllSkills(workspace)) if (!byName.has(skill.name)) byName.set(skill.name, skill);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The `description:` line of a SKILL.md front matter block, if any. */
export function skillDescription(content: string): string | undefined {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const line = front?.[1].split(/\r?\n/).find((item) => /^description\s*:/.test(item));
  const value = line?.replace(/^description\s*:\s*/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
  return value || undefined;
}

/** Absolute path of a global skill's SKILL.md. */
export function globalSkillPath(source: SkillSource, name: string, home = homedir()) {
  if (!validName(name)) throw new Error("Invalid skill name.");
  return join(home, `.${source}`, "skills", name, "SKILL.md");
}

/** Workspace-relative path of a workspace skill's SKILL.md. */
export function workspaceSkillPath(source: SkillSource, name: string) {
  if (!validName(name)) throw new Error("Invalid skill name.");
  return `${sourceFolder(source)}/${name}/SKILL.md`;
}

/**
 * Creates, updates (content) or deletes (content undefined) a global skill. Needs the exact current content, so a
 * stale editor never overwrites a newer file. Deleting removes SKILL.md and the folder only when nothing else is in it.
 */
export async function changeGlobalSkill(
  source: SkillSource,
  name: string,
  content: string | undefined,
  expectedContent: string | undefined,
  home = homedir(),
) {
  const path = globalSkillPath(source, name, home);
  let previous: string | undefined;
  try {
    previous = await readFile(path, "utf8");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (previous !== expectedContent) throw new Error("Skill changed. Refresh the list before saving.");
  if (content === undefined) {
    if (previous === undefined) throw new Error("Skill no longer exists.");
    await unlink(path);
    await rmdir(dirname(path)).catch(() => undefined);
    return { path };
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, previous === undefined ? { flag: "wx" } : {});
  return { path };
}

export async function readSkill(workspace: Workspace, name: string): Promise<Skill> {
  const skill = validName(name) ? (await listSkills(workspace)).find((item) => item.name === name) : undefined;
  if (!skill) throw new Error(`No skill named "${name}" in this workspace or the global skill folders.`);
  return skill;
}

/** Writes ~/.basedcode/skills/<name>/SKILL.md; updating needs the exact current content. */
export async function writeGlobalSkill(name: string, content: string, expectedContent?: string) {
  if (!validName(name)) throw new Error("Invalid skill name.");
  const directory = join(globalSkillRoots()[0], name);
  const path = join(directory, "SKILL.md");
  let previous: string | undefined;
  try {
    previous = await readFile(path, "utf8");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (previous !== expectedContent)
    throw new Error(
      previous === undefined
        ? "Skill does not exist yet; omit expectedContent to create it."
        : "Skill already exists; pass its exact current content as expectedContent to update it.",
    );
  await mkdir(directory, { recursive: true });
  await writeFile(path, content, previous === undefined ? { flag: "wx" } : {});
  return { path, saved: true, scope: "global" as const };
}

const mentionPattern = /(^|\s)@([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s.,;:!?)])/g;

/** Skill names mentioned as @name anywhere in the text, in order, without duplicates. */
export function skillMentions(text: string): string[] {
  return [...new Set([...text.matchAll(mentionPattern)].map((match) => match[2]))];
}
