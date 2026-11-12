import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findGit } from '../workspace/workspace.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { instructionsPrompt, loadInstructions } from './instructions.js';

test('loads root, parent and nested instruction files, skipping dependency folders', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'basedcode-instr-'));
  const workspace = join(parent, 'repo');
  try {
    await mkdir(join(workspace, 'packages', 'api'), { recursive: true });
    await mkdir(join(workspace, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(parent, 'AGENTS.md'), 'parent rules');
    await writeFile(join(workspace, 'CLAUDE.md'), 'root rules');
    await writeFile(join(workspace, 'packages', 'api', 'AGENTS.md'), 'api rules');
    await writeFile(join(workspace, 'node_modules', 'x', 'AGENTS.md'), 'ignored');
    const files = (await loadInstructions(workspace)).filter(file => file.path.startsWith(parent));
    assert.deepEqual(files.map(file => [file.label.endsWith('AGENTS.md') && file.scope === 'workspace' ? 'parent' : file.label, file.scope]), [
      ['parent', 'workspace'], ['CLAUDE.md', 'workspace'], ['packages/api/AGENTS.md', 'nested'],
    ]);
    const prompt = instructionsPrompt(files);
    assert.match(prompt, /scope="packages\/api\/"/);
    assert.doesNotMatch(prompt, /ignored/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('excludes Git-ignored instructions before applying nested discovery limits', async (t) => {
  const git = await findGit();
  if (!git) return t.skip('Git is unavailable');
  const parent = await mkdtemp(join(tmpdir(), 'basedcode-instr-git-'));
  const workspace = join(parent, 'repo');
  try {
    await mkdir(workspace);
    await promisify(execFile)(git, ['init', '--quiet'], { cwd: parent });
    await writeFile(join(parent, '.gitignore'), 'AGENTS.md\nrepo/generated/\n!repo/keep/AGENTS.md\n');
    await writeFile(join(parent, 'AGENTS.md'), 'ignored parent');
    await writeFile(join(workspace, 'AGENTS.md'), 'ignored root');
    await writeFile(join(workspace, 'CLAUDE.md'), 'root rules');
    await mkdir(join(workspace, 'generated'));
    await writeFile(join(workspace, 'generated', 'CLAUDE.md'), 'ignored directory');
    // Ignored files must not exhaust the nested directory limit.
    for (let i = 0; i < 25; i++) {
      const directory = join(workspace, `a-${i}`);
      await mkdir(directory);
      await writeFile(join(directory, 'AGENTS.md'), 'ignored nested');
    }
    await mkdir(join(workspace, 'keep'));
    await writeFile(join(workspace, 'keep', 'AGENTS.md'), 'included exception');
    await mkdir(join(workspace, 'z-nested'));
    await writeFile(join(workspace, 'z-nested', '.gitignore'), 'CLAUDE.md\n');
    await writeFile(join(workspace, 'z-nested', 'CLAUDE.md'), 'ignored by nested rule');
    const files = (await loadInstructions(workspace)).filter(file => file.path.startsWith(parent));
    assert.deepEqual(files.map(file => file.label), ['CLAUDE.md', 'keep/AGENTS.md']);
    assert.doesNotMatch(instructionsPrompt(files), /ignored/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
