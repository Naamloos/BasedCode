import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changeGlobalSkill, listAllSkills, skillDescription } from "./skills.js";

test("global skills come from every skill folder family, in lookup order", async () => {
  const home = await mkdtemp(join(tmpdir(), "skills-home-"));
  try {
    for (const [source, name] of [["claude", "review"], ["agents", "review"], ["codex", "deploy"]]) {
      await mkdir(join(home, `.${source}`, "skills", name), { recursive: true });
      await writeFile(join(home, `.${source}`, "skills", name, "SKILL.md"), `# ${source}`);
    }
    const skills = await listAllSkills(undefined, home);
    assert.deepEqual(
      skills.map((skill) => `${skill.source}/${skill.name}`),
      ["claude/review", "codex/deploy", "agents/review"],
    );
    assert.ok(skills.every((skill) => skill.scope === "global"));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("changeGlobalSkill creates, refuses stale updates and deletes", async () => {
  const home = await mkdtemp(join(tmpdir(), "skills-home-"));
  try {
    const { path } = await changeGlobalSkill("claude", "lint", "v1", undefined, home);
    assert.equal(await readFile(path, "utf8"), "v1");
    await assert.rejects(changeGlobalSkill("claude", "lint", "v2", "old", home), /changed/);
    await changeGlobalSkill("claude", "lint", "v2", "v1", home);
    await changeGlobalSkill("claude", "lint", undefined, "v2", home);
    await assert.rejects(stat(join(home, ".claude", "skills", "lint")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("skillDescription reads the front matter description", () => {
  assert.equal(skillDescription("---\nname: x\ndescription: \"Reviews code\"\n---\nBody"), "Reviews code");
  assert.equal(skillDescription("# No front matter"), undefined);
});
