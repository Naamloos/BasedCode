export type LoginProvider = "codex" | "claude" | "antigravity";

/** Folders the Antigravity CLI signs in from, so its login lands in BasedCode's private home. */
export interface AntigravityLoginFolders {
  home: string;
  cwd: string;
}

/** Single-quotes a value for PowerShell on Windows or a POSIX shell elsewhere. */
export function shellQuote(value: string, platform: NodeJS.Platform): string {
  const escapedQuote = platform === "win32" ? "''" : "'\\''";
  return "'" + value.replaceAll("'", escapedQuote) + "'";
}

/** The interactive terminal command that runs a provider CLI's own sign-in flow. */
export function loginCommand(
  provider: LoginProvider,
  executable: string,
  platform: NodeJS.Platform,
  antigravity?: AntigravityLoginFolders,
): string {
  const quote = (value: string) => shellQuote(value, platform);
  const isWindows = platform === "win32";

  const quotedExecutable = quote(executable);
  const launcher = /\.[cm]?js$/i.test(executable)
    ? "node " + quotedExecutable
    : quotedExecutable;

  let subcommand = " auth login";
  if (provider === "codex") subcommand = " login";
  if (provider === "antigravity") subcommand = "";

  const command = (isWindows ? "& " : "") + launcher + subcommand;
  if (provider !== "antigravity" || !antigravity) return command;

  const { home, cwd } = antigravity;
  if (isWindows)
    return `$env:HOME = ${quote(home)}; $env:USERPROFILE = ${quote(home)}; Set-Location -LiteralPath ${quote(cwd)}; ${command}`;
  return `cd ${quote(cwd)} && HOME=${quote(home)} USERPROFILE=${quote(home)} ${command}`;
}
