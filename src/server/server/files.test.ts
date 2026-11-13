import assert from "node:assert/strict";
import { test } from "node:test";
import { editorArguments } from "./files.js";

test("editorArguments fills explicit line and column placeholders", () => {
  const args = editorArguments(["{file}", "+{line}:{column}"], "/repo", "/repo/a.ts", 4, 2);

  assert.deepEqual(args, ["/repo/a.ts", "+4:2"]);
});

test("editorArguments appends the position after --goto when no placeholder exists", () => {
  const args = editorArguments(["--goto", "{file}"], "/repo", "/repo/a.ts", 7);

  assert.deepEqual(args, ["--goto", "/repo/a.ts:7:1"]);
});

test("editorArguments leaves the file bare without a line", () => {
  const args = editorArguments(["-g", "{file}", "{workspace}"], "/repo", "/repo/a.ts");

  assert.deepEqual(args, ["-g", "/repo/a.ts", "/repo"]);
});
