import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Screenshots are scaled to fit this box: big enough to read UI text, small enough to keep image tokens sane. */
export const screenshotBox = { width: 1280, height: 800 };

export interface ScreenFit {
  /** Screenshot size; the model's coordinates are in this space. */
  width: number;
  height: number;
  /** Physical screen pixels per screenshot pixel. */
  scale: number;
}

export function fitScreen(screenWidth: number, screenHeight: number, box = screenshotBox): ScreenFit {
  const scale = Math.max(1, screenWidth / box.width, screenHeight / box.height);
  return {
    width: Math.max(1, Math.round(screenWidth / scale)),
    height: Math.max(1, Math.round(screenHeight / scale)),
    scale,
  };
}

export interface KeyStroke {
  vk: number;
  extended: boolean;
}

const named: Record<string, number> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, option: 0x12,
  enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08,
  capslock: 0x14, printscreen: 0x2c, print: 0x2c, pause: 0x13,
  plus: 0xbb, minus: 0xbd, '-': 0xbd, '=': 0xbb, '+': 0xbb, '[': 0xdb, ']': 0xdd, '\\': 0xdc,
  ';': 0xba, "'": 0xde, ',': 0xbc, '.': 0xbe, '/': 0xbf, '`': 0xc0,
};
/** Keys that need KEYEVENTF_EXTENDEDKEY, or Windows reads them as their numpad twins. */
const extendedKeys: Record<string, number> = {
  win: 0x5b, windows: 0x5b, super: 0x5b, meta: 0x5b, cmd: 0x5b, command: 0x5b,
  delete: 0x2e, del: 0x2e, insert: 0x2d, ins: 0x2d, home: 0x24, end: 0x23,
  pageup: 0x21, prior: 0x21, pagedown: 0x22, next: 0x22,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28, menu: 0x5d, apps: 0x5d,
};

/** One key name (xdotool-style names accepted too: Return, BackSpace, Page_Down, super) as a Windows virtual key. */
export function keyStroke(name: string): KeyStroke {
  const key = name.length > 1 ? name.trim().toLowerCase().replace(/[_\s]/g, '') : name.toLowerCase();
  if (key in extendedKeys) return { vk: extendedKeys[key], extended: true };
  if (key in named) return { vk: named[key], extended: false };
  if (/^[a-z0-9]$/.test(key)) return { vk: key.toUpperCase().charCodeAt(0), extended: false };
  const fn = /^f([1-9]|1\d|2[0-4])$/.exec(key);
  if (fn) return { vk: 0x6f + Number(fn[1]), extended: false };
  throw new Error(`Unknown key "${name}". Use names like ctrl, shift, alt, win, enter, tab, esc, up, f5, a, 1.`);
}

/** A combination such as "ctrl+shift+t" or "ctrl++", pressed in order and released in reverse. */
export function keyCombo(combo: string): KeyStroke[] {
  const parts = combo.trim().split(/\+(?!$)/).filter(Boolean);
  if (!parts.length) throw new Error('Name at least one key.');
  return parts.map(keyStroke);
}

export interface WindowInfo {
  Handle: number;
  Pid: number;
  Title: string;
}

export interface ProcessEntry {
  Pid: number;
  Parent: number;
  Name: string;
}

/**
 * Processes whose windows the agent must never touch: the BasedCode desktop window and its renderers, so a model
 * can't click its own approval buttons. They are the launcher's descendants minus this server's own subtree,
 * which holds the user's terminals and the apps they start.
 */
export function protectedProcesses(tree: ProcessEntry[], self: number, launcher: number | undefined): Set<number> {
  const children = new Map<number, number[]>();
  for (const entry of tree) {
    if (entry.Pid === entry.Parent) continue;
    children.set(entry.Parent, [...(children.get(entry.Parent) ?? []), entry.Pid]);
  }
  const subtree = (root: number) => {
    const found = new Set<number>([root]);
    const queue = [root];
    while (queue.length) for (const child of children.get(queue.pop()!) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
    return found;
  };
  if (launcher === undefined) return new Set();
  const own = subtree(self);
  const result = subtree(launcher);
  result.delete(launcher);
  for (const pid of own) result.delete(pid);
  return result;
}

/** BasedCode's window or a browser tab showing its UI (title "BasedCode", e.g. "BasedCode - Google Chrome"). */
export const basedCodeTitle = (title: string) => /^BasedCode(?:$|\s[-—–]\s|\sand\s\d+\smore)/.test(title.trim());

// Runs inside one long-lived Windows PowerShell; compiled once per helper, then driven by JSON lines on stdin.
const source = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class BcWindow { public long Handle { get; set; } public uint Pid { get; set; } public string Title { get; set; } }
public class BcProcess { public uint Pid { get; set; } public uint Parent { get; set; } public string Name { get; set; } }

public static class BcDesktop {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct PROCESSENTRY32 {
    public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID;
    public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  // Physical pixels everywhere, so screenshots and cursor positions agree on scaled displays.
  public static void Init() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { }
    SetProcessDPIAware();
  }

  public static int[] Size() { return new int[] { GetSystemMetrics(0), GetSystemMetrics(1) }; }

  public static int[] Cursor() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }

  public static string Capture(int width, int height) {
    int sw = GetSystemMetrics(0), sh = GetSystemMetrics(1);
    using (var full = new Bitmap(sw, sh, PixelFormat.Format24bppRgb))
    using (var scaled = new Bitmap(width, height, PixelFormat.Format24bppRgb))
    using (var stream = new MemoryStream()) {
      using (var g = Graphics.FromImage(full)) g.CopyFromScreen(0, 0, 0, 0, new Size(sw, sh), CopyPixelOperation.SourceCopy);
      using (var g = Graphics.FromImage(scaled)) {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(full, 0, 0, width, height);
      }
      scaled.Save(stream, ImageFormat.Png);
      return Convert.ToBase64String(stream.ToArray());
    }
  }

  static void Send(INPUT[] inputs) {
    if (inputs.Length == 0) return;
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
      throw new Exception("Windows blocked the input (error " + Marshal.GetLastWin32Error() + "). The target may run as administrator, or the desktop is locked.");
  }
  static INPUT Mouse(uint flags, int data) { var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i; }
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }

  public static void Move(int x, int y) { if (!SetCursorPos(x, y)) throw new Exception("Could not move the cursor."); }

  public static void Button(string button, bool down) {
    uint flags;
    if (button == "left") flags = down ? 0x2u : 0x4u;
    else if (button == "right") flags = down ? 0x8u : 0x10u;
    else if (button == "middle") flags = down ? 0x20u : 0x40u;
    else throw new Exception("Unknown mouse button " + button);
    Send(new INPUT[] { Mouse(flags, 0) });
  }

  public static void Scroll(int dx, int dy) {
    if (dy != 0) Send(new INPUT[] { Mouse(0x0800, -dy * 120) });
    if (dx != 0) Send(new INPUT[] { Mouse(0x1000, dx * 120) });
  }

  public static void Keys(int[] vks, int[] extended, bool down) {
    var list = new List<INPUT>();
    for (int n = 0; n < vks.Length; n++) {
      int i = down ? n : vks.Length - 1 - n;
      list.Add(Key((ushort)vks[i], 0, (extended[i] != 0 ? 1u : 0u) | (down ? 0u : 2u)));
    }
    Send(list.ToArray());
  }

  public static void Type(string text) {
    var list = new List<INPUT>();
    foreach (char c in text) {
      if (c == '\r') continue;
      ushort vk = c == '\n' ? (ushort)0x0D : c == '\t' ? (ushort)0x09 : (ushort)0;
      if (vk != 0) { list.Add(Key(vk, 0, 0)); list.Add(Key(vk, 0, 2)); continue; }
      list.Add(Key(0, c, 4)); list.Add(Key(0, c, 6));
    }
    // Small batches: apps drop characters when a whole paragraph lands in one input burst.
    for (int i = 0; i < list.Count; i += 64) {
      Send(list.GetRange(i, Math.Min(64, list.Count - i)).ToArray());
      Thread.Sleep(8);
    }
  }

  static BcWindow Info(IntPtr h) {
    var root = h == IntPtr.Zero ? IntPtr.Zero : GetAncestor(h, 2);
    if (root == IntPtr.Zero) root = h;
    var title = new StringBuilder(512);
    uint pid = 0;
    if (root != IntPtr.Zero) { GetWindowText(root, title, title.Capacity); GetWindowThreadProcessId(root, out pid); }
    return new BcWindow { Handle = root.ToInt64(), Pid = pid, Title = title.ToString() };
  }

  public static BcWindow At(int x, int y) { var p = new POINT(); p.X = x; p.Y = y; return Info(WindowFromPoint(p)); }

  public static BcWindow Foreground() { return Info(GetForegroundWindow()); }

  // Windows only lets the foreground's input queue hand focus over, so briefly share it.
  public static bool Focus(long handle) {
    var h = new IntPtr(handle);
    if (!IsWindow(h)) return false;
    if (IsIconic(h)) ShowWindow(h, 9);
    uint ignored;
    uint current = GetWindowThreadProcessId(GetForegroundWindow(), out ignored), me = GetCurrentThreadId();
    bool attached = current != 0 && current != me && AttachThreadInput(me, current, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, current, false);
    Thread.Sleep(80);
    return GetAncestor(GetForegroundWindow(), 2) == h || GetForegroundWindow() == h;
  }

  public static BcProcess[] Tree() {
    var result = new List<BcProcess>();
    var snapshot = CreateToolhelp32Snapshot(2, 0);
    if (snapshot == new IntPtr(-1)) throw new Exception("Could not list processes.");
    try {
      var entry = new PROCESSENTRY32();
      entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
      for (bool more = Process32FirstW(snapshot, ref entry); more; more = Process32NextW(snapshot, ref entry))
        result.Add(new BcProcess { Pid = entry.th32ProcessID, Parent = entry.th32ParentProcessID, Name = entry.szExeFile });
    } finally { CloseHandle(snapshot); }
    return result.ToArray();
  }
}
`;

const loop = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $source
[BcDesktop]::Init()
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id = $null
  try {
    $c = $line | ConvertFrom-Json
    $id = $c.id
    $r = $null
    switch ($c.op) {
      'size' { $r = [BcDesktop]::Size() }
      'cursor' { $r = [BcDesktop]::Cursor() }
      'capture' { $r = [BcDesktop]::Capture([int]$c.width, [int]$c.height) }
      'move' { [BcDesktop]::Move([int]$c.x, [int]$c.y) }
      'button' { [BcDesktop]::Button([string]$c.button, [bool]$c.down) }
      'scroll' { [BcDesktop]::Scroll([int]$c.dx, [int]$c.dy) }
      'keys' { [BcDesktop]::Keys([int[]]@($c.vks), [int[]]@($c.extended), [bool]$c.down) }
      'type' { [BcDesktop]::Type([string]$c.text) }
      'at' { $r = [BcDesktop]::At([int]$c.x, [int]$c.y) }
      'foreground' { $r = [BcDesktop]::Foreground() }
      'focus' { $r = [BcDesktop]::Focus([long]$c.handle) }
      'tree' { $r = [BcDesktop]::Tree() }
      default { throw "Unknown operation $($c.op)" }
    }
    $out = @{ id = $id; ok = $true; result = $r }
  } catch {
    $out = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Compress -Depth 4))
}
`;

// Non-ASCII goes over stdin as \u escapes, so the console code page can't mangle typed text.
const asciiJson = (value: unknown) =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/** The Windows input and screen helper. One per server: there is one desktop. */
export class DesktopDriver {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<ChildProcessWithoutNullStreams>;
  private readonly pending = new Map<number, Pending>();
  private next = 1;

  async call<T = unknown>(op: string, args: Record<string, unknown> = {}, timeout = 15_000): Promise<T> {
    const child = await this.start();
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Desktop helper timed out on ${op}.`));
      }, timeout);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      child.stdin.write(`${asciiJson({ id, op, ...args })}\n`);
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
  }

  private start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child && this.child.exitCode === null) return Promise.resolve(this.child);
    if (this.starting) return this.starting;
    this.starting = new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      const script = `$source = @'\n${source}\n'@\n${loop}`;
      const bootstrap =
        '$s = [Console]::In.ReadLine(); Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)))';
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', bootstrap], {
        windowsHide: true,
        stdio: 'pipe',
      });
      let ready = false;
      let errors = '';
      const fail = (error: Error) => {
        for (const item of this.pending.values()) {
          clearTimeout(item.timer);
          item.reject(error);
        }
        this.pending.clear();
        if (this.child === child) this.child = undefined;
        if (!ready) reject(error);
      };
      const startup = setTimeout(() => {
        child.kill();
        fail(new Error('Desktop helper did not start in time.'));
      }, 30_000);
      child.stderr.on('data', (chunk: Buffer) => {
        errors = (errors + chunk.toString()).slice(-2000);
      });
      child.on('error', (error) => {
        clearTimeout(startup);
        fail(error);
      });
      child.on('exit', (code) => {
        clearTimeout(startup);
        fail(new Error(`Desktop helper exited (${code}). ${errors.trim().split('\n')[0] ?? ''}`.trim()));
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        let message: { ready?: boolean; id?: number; ok?: boolean; result?: unknown; error?: string };
        try {
          message = JSON.parse(line.replace(/^﻿/, ''));
        } catch {
          return;
        }
        if (message.ready && !ready) {
          ready = true;
          clearTimeout(startup);
          this.child = child;
          resolve(child);
          return;
        }
        const item = message.id === undefined ? undefined : this.pending.get(message.id);
        if (!item) return;
        this.pending.delete(message.id!);
        clearTimeout(item.timer);
        if (message.ok) item.resolve(message.result);
        else item.reject(new Error(message.error ?? 'Desktop helper failed.'));
      });
      child.stdin.write(`${Buffer.from(script, 'utf8').toString('base64')}\n`);
      // The helper must not keep the server alive on shutdown.
      child.unref();
      (child.stdin as unknown as { unref?: () => void }).unref?.();
      (child.stdout as unknown as { unref?: () => void }).unref?.();
      (child.stderr as unknown as { unref?: () => void }).unref?.();
    }).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }
}
