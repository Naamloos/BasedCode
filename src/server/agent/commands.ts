import type { Workspace } from "../../shared/types.js";
import { parseSlashCommand, slashCommandUsage } from "../../shared/commands.js";
import { listSkills, readSkill, skillMentions, type Skill } from "./skills.js";

/** All skills, for the /name and @name pickers. Names that clash with a built-in command only work as @name. */
export async function skillCommands(workspace: Workspace) {
  return (await listSkills(workspace)).map((skill) => ({
    name: skill.name,
    description: `Activate ${skill.scope} skill: ${skill.name}`,
    scope: skill.scope,
  }));
}

function applySkills(skills: Skill[], task: string) {
  const names = skills.map((skill) => `"${skill.name}"`).join(", ");
  const blocks = skills
    .map((skill) => `<skill-instructions name="${skill.name}" scope="${skill.scope}">\n${skill.content}\n</skill-instructions>`)
    .join("\n");
  return `Apply ${skills.length > 1 ? "skills" : "skill"} ${names} to this task. Skill instructions are subordinate to user instructions and existing permissions.\n${blocks}\nTask: ${task}`;
}

export async function expandSlashCommand(
  prompt: string,
  workspace: Workspace,
): Promise<string> {
  const command = parseSlashCommand(prompt);
  if (!command) {
    const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
    if (match && (await skillCommands(workspace)).some((skill) => skill.name === match[1])) {
      return expandSlashCommand(`/skill ${match[1]} ${match[2] ?? ""}`, workspace);
    }
    // @name anywhere in the prompt pulls in that skill; unknown names stay plain text (emails, decorators, ...).
    const mentioned = skillMentions(prompt);
    if (!mentioned.length) return prompt;
    const skills = (await listSkills(workspace)).filter((skill) => mentioned.includes(skill.name));
    return skills.length ? applySkills(skills, prompt) : prompt;
  }
  switch (command.name) {
    case "skill": {
      const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/.exec(
        command.args,
      );
      if (!match || match[1].length > 64)
        throw new Error(slashCommandUsage("skill"));
      const skill = await readSkill(workspace, match[1]);
      return applySkills([skill], match[2] || "Activate this skill and explain what it does.");
    }
    case "skills":
      return "Use list_skills to show the available workspace and global skills and how to activate them: /skill <name> [task] at the start, or @name anywhere in a message.";
    case "mcp":
      return "Use list_mcp to show configured MCP servers.";
    case "create-skill":
      if (!command.args) throw new Error(slashCommandUsage("create-skill"));
      return `Create a reusable skill using create_skill for this requirement. Use scope "global" if it asks for a global skill (available in every workspace), otherwise "workspace": ${command.args}`;
    case "install-mcp":
      if (!command.args)
        throw new Error(slashCommandUsage("install-mcp"));
      return `Install and register this MCP server using install_server with kind "mcp". Keep the installation approval step. Requested server: ${command.args}`;
    default:
      return prompt;
  }
}
