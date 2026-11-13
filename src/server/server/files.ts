import spawn from "cross-spawn";
import type { Workspace } from "../../shared/types.js";
import { splitGitDiff } from "../workspace/diff.js";
import { gitRead } from "../workspace/workspace.js";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { previewMediaType } from "../../shared/preview.js";
import { isTextAttachment } from "../agent/context.js";

export const attachmentLimit = 20 * 1024 * 1024;
const browseEntryLimit = 1000;

/** Lists a folder for the human file picker; never exposed as an agent tool. */
export async function browseFolder(path: string, directoriesOnly: boolean) {
  if (!isAbsolute(path)) throw new Error("Enter an absolute folder path.");
  const directory = await realpath(path);

  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        !entry.isSymbolicLink() &&
        (entry.isDirectory() || (!directoriesOnly && entry.isFile())),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    );

  return {
    path: directory,
    parent: dirname(directory),
    truncated: entries.length > browseEntryLimit,
    entries: entries.slice(0, browseEntryLimit).map((entry) => ({
      name: entry.name,
      path: join(directory, entry.name),
      directory: entry.isDirectory(),
    })),
  };
}

/** Reads a file the human picked as an attachment, as base64. */
export async function readAttachment(path: string) {
  if (!isAbsolute(path)) throw new Error("Select an absolute file path.");
  const file = await realpath(path);
  const info = await stat(file);
  if (!info.isFile()) throw new Error("Select a regular file.");
  if (info.size > attachmentLimit)
    throw new Error("Attachments are limited to 20 MiB each.");

  // Checked again after reading: the file can grow between stat and read.
  const data = await readFile(file);
  if (data.length > attachmentLimit)
    throw new Error("Attachments are limited to 20 MiB each.");

  const fallbackType = isTextAttachment({ name: file, mediaType: "" })
    ? "text/plain"
    : "application/octet-stream";
  return {
    name: basename(file),
    mediaType: previewMediaType(file) ?? fallbackType,
    data: data.toString("base64"),
  };
}

/** Fills the editor's argument template for a file and optional position. */
export function editorArguments(
  args: string[],
  workspacePath: string,
  file: string,
  line?: number,
  column?: number,
): string[] {
  const position = { line: String(line ?? 1), column: String(column ?? 1) };
  const hasLinePlaceholder = args.some((arg) => arg.includes("{line}"));

  // Without {line} placeholders, VS Code style `--goto {file}` / `-g {file}` still jumps when given file:line:column.
  return args.map((arg, index) => {
    const isGotoTarget =
      line !== undefined &&
      !hasLinePlaceholder &&
      arg === "{file}" &&
      ["--goto", "-g"].includes(args[index - 1] ?? "");
    const withFile = isGotoTarget
      ? `${file}:${position.line}:${position.column}`
      : arg.replaceAll("{file}", file);

    return withFile
      .replaceAll("{workspace}", workspacePath)
      .replaceAll("{line}", position.line)
      .replaceAll("{column}", position.column);
  });
}

/** Starts the workspace's configured editor detached, resolving once the process has spawned. */
export async function openInEditor(
  workspace: Workspace,
  file: string,
  line?: number,
  column?: number,
): Promise<void> {
  const { command, args } = workspace.settings.editor;
  const expanded = editorArguments(args, workspace.path, file, line, column);

  const child = spawn(command, expanded, {
    cwd: workspace.path,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}

/** The working tree diff split per file, or the raw status when Git has nothing to split. */
export async function workspaceChanges(workspace: Workspace) {
  try {
    const [diff, status] = await Promise.all([
      gitRead(workspace, "diff"),
      gitRead(workspace, "status"),
    ]);
    const changes = splitGitDiff(diff);
    return changes.length
      ? { changes }
      : { git: diff, status: status || "Working tree clean." };
  } catch (error) {
    const reason =
      error instanceof Error
        ? (error as Error & { stderr?: string }).stderr?.trim() || error.message
        : String(error);
    return { git: "", status: `No Git diff available: ${reason}` };
  }
}
