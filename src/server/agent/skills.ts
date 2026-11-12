import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { Workspace } from "../../shared/types.js";
import { fileTree, readText } from "../workspace/workspace.js";

export const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const maxSkillLength = 50_000;
const workspaceRoot = ".basedcode/skills";

export interface Skill {
  name: string;
  scope: "workspace" | "global";
  /** Workspace-relative for workspace skills, absolute for global ones. */
  path: string;
  content: string;
}

const validName = (name: string) => skillNamePattern.test(name) && name.length <= 64;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Global skill folders in lookup order; the first is where new global skills are written. */
export function globalSkillRoots(home = homedir()) {
  return [".basedcode", ".claude", ".codex", ".agents"].map((folder) => join(home, folder, "skills"));
}

async function workspaceSkills(workspace: Workspace): Promise<Skill[]> {
  let entries;
  try {
    entries = await fileTree(workspace, workspaceRoot);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.directory || !validName(entry.name)) continue;
    const path = `${workspaceRoot}/${entry.name}/SKILL.md`;
    try {
      const { content, binary } = await readText(workspace, path);
      if (!binary && content.length <= maxSkillLength)
        skills.push({ name: entry.name, scope: "workspace", path, content });
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  return skills;
}

async function globalSkills(root: string): Promise<Skill[]> {
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
        skills.push({ name: entry.name, scope: "global", path, content });
    } catch {
      // Not a skill folder (or unreadable): skip it like a folder without SKILL.md.
    }
  }
  return skills;
}

/** Every skill by name; a workspace skill shadows a global one, earlier global roots shadow later ones. */
export async function listSkills(workspace: Workspace): Promise<Skill[]> {
  const found = [await workspaceSkills(workspace)];
  for (const root of globalSkillRoots()) found.push(await globalSkills(root));
  const byName = new Map<string, Skill>();
  for (const skill of found.flat()) if (!byName.has(skill.name)) byName.set(skill.name, skill);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
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
