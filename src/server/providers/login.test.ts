import assert from "node:assert/strict";
import { test } from "node:test";
import { loginCommand, shellQuote } from "./login.js";

test("shellQuote escapes single quotes per shell", () => {
  assert.equal(shellQuote("it's", "win32"), "'it''s'");
  assert.equal(shellQuote("it's", "linux"), "'it'\\''s'");
});

test("loginCommand uses each CLI's sign-in subcommand", () => {
  assert.equal(loginCommand("codex", "/bin/codex", "linux"), "'/bin/codex' login");
  assert.equal(
    loginCommand("claude", "C:\\claude.exe", "win32"),
    "& 'C:\\claude.exe' auth login",
  );
});

test("loginCommand runs JavaScript entry points through node", () => {
  assert.equal(
    loginCommand("claude", "/lib/cli.mjs", "linux"),
    "node '/lib/cli.mjs' auth login",
  );
});

test("loginCommand signs Antigravity in from its private home", () => {
  const folders = { home: "/data/home", cwd: "/data/workspace" };

  assert.equal(
    loginCommand("antigravity", "/bin/agy", "linux", folders),
    "cd '/data/workspace' && HOME='/data/home' USERPROFILE='/data/home' '/bin/agy'",
  );
  assert.equal(
    loginCommand("antigravity", "C:\\agy.exe", "win32", folders),
    "$env:HOME = '/data/home'; $env:USERPROFILE = '/data/home'; Set-Location -LiteralPath '/data/workspace'; & 'C:\\agy.exe'",
  );
});
