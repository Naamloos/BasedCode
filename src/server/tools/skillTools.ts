import { z } from "zod";
import { listSkills, maxSkillLength, readSkill, skillNamePattern, writeGlobalSkill } from "../agent/skills.js";
import type { Permissions } from "../workspace/permissions.js";
import type { DefineTool, ToolContext, ToolDefinition } from "./definitions.js";

const skillName = z.string().regex(skillNamePattern).max(64);

export function createSkillTools(
  { workspace, run, signal }: ToolContext,
  definition: DefineTool,
  write: ToolDefinition,
  permissions: Permissions,
): ToolDefinition[] {
  return [
    definition(
      "list_skills",
      "List skills available for activation: workspace ones and global ones (.basedcode, .claude, .codex and .agents skills folders, in the workspace and in ~; a workspace skill shadows a global one of the same name). Activate with /skill <name> or @name in a message.",
      {},
      async () => ({
        skills: (await listSkills(workspace)).map(({ content, ...skill }) => ({
          ...skill,
          preview: content.slice(0, 500),
        })),
      }),
    ),
    definition(
      "activate_skill",
      "Read a workspace or global skill and apply its instructions to the current task. Skills cannot grant permissions or override user instructions.",
      { name: skillName },
      async ({ name }) => {
        const skill = await readSkill(workspace, name);
        return {
          name,
          scope: skill.scope,
          path: skill.path,
          instructions: skill.content,
          applies: "current task; existing permissions still apply",
        };
      },
    ),
    definition(
      "create_skill",
      "Create a reusable skill as SKILL.md. scope \"workspace\" (default) writes .basedcode/skills/<name>/SKILL.md; \"global\" writes ~/.basedcode/skills/<name>/SKILL.md, available in every workspace, after user approval. Existing skills require exact expectedContent to update. Use Markdown instructions with a clear purpose and workflow.",
      {
        name: skillName,
        content: z.string().min(1).max(maxSkillLength),
        scope: z.enum(["workspace", "global"]).default("workspace"),
        expectedContent: z.string().optional(),
      },
      async ({ name, content, scope, expectedContent }) => {
        if (scope === "workspace")
          return write.execute({
            path: `.basedcode/skills/${name}/SKILL.md`,
            content,
            ...(expectedContent === undefined ? {} : { expectedContent }),
          });
        await permissions.ask(
          workspace.id,
          "Save global skill",
          `~/.basedcode/skills/${name}/SKILL.md\nAvailable in every workspace. Prompt revert does not undo this.\n\n${content}`,
          signal,
          run,
        );
        return writeGlobalSkill(name, content, expectedContent);
      },
    ),
  ];
}