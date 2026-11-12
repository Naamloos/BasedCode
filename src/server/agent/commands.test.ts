import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "../../shared/types.js";
import { parseSlashCommand } from "../../shared/commands.js";
import { expandSlashCommand } from "./commands.js";

test("slash commands preserve ordinary prompts and multiline arguments", () => {
  assert.equal(parseSlashCommand("/unknown stuff"), undefined);
  assert.equal(parseSlashCommand("Use /skill in prose"), undefined);
  assert.deepEqual(parseSlashCommand(" /skill review\ncheck this "), {
    name: "skill",
    args: "review\ncheck this",
  });
});

test("skill activation loads workspace instructions and rejects invalid or missing skills", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basedcode-skills-"));
  const workspace = { path: await realpath(directory) } as Workspace;
  try {
    await mkdir(join(directory, ".basedcode/skills/review"), {
      recursive: true,
    });
    await writeFile(
      join(directory, ".basedcode/skills/review/SKILL.md"),
      "# Review\nCheck correctness.",
    );
    const direct = await expandSlashCommand("/review inspect changes", workspace);
    assert.ok(direct.includes("Task: inspect changes"));
    assert.ok(direct.includes("# Review"));
    const expanded = await expandSlashCommand(
      "/skill review inspect changes",
      workspace,
    );
    assert.ok(expanded.includes("# Review\nCheck correctness."));
    assert.ok(expanded.includes("Task: inspect changes"));
    await assert.rejects(
      expandSlashCommand("/skill ../outside", workspace),
      /Usage/,
    );
    await assert.rejects(
      expandSlashCommand("/skill missing", workspace),
      /No skill named "missing"/,
    );
    assert.equal(
      await expandSlashCommand("normal prompt", workspace),
      "normal prompt",
    );
    const mentioned = await expandSlashCommand("Look at this diff, @review. Thanks", workspace);
    assert.ok(mentioned.includes("# Review\nCheck correctness."));
    assert.ok(mentioned.includes("Task: Look at this diff, @review. Thanks"));
    for (const plain of ["mail me@review.dev", "use @missing here", "see @review/path"])
      assert.equal(await expandSlashCommand(plain, workspace), plain);
    await assert.rejects(
      expandSlashCommand("/create-skill", workspace),
      /Usage/,
    );
    await assert.rejects(
      expandSlashCommand("/install-mcp", workspace),
      /Usage/,
    );
    assert.ok(
      (
        await expandSlashCommand("/install-mcp server@1.0.0 server", workspace)
      ).includes("installation approval"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
