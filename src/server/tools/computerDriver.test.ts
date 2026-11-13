import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basedCodeTitle, fitScreen, keyCombo, keyStroke, protectedProcesses } from './computerDriver.js';

test('screenshots fit the box and keep the aspect ratio', () => {
  assert.deepEqual(fitScreen(2560, 1440), { width: 1280, height: 720, scale: 2 });
  assert.deepEqual(fitScreen(1920, 1200), { width: 1280, height: 800, scale: 1.5 });
  assert.deepEqual(fitScreen(1024, 768), { width: 1024, height: 768, scale: 1 });
  assert.equal(fitScreen(3840, 2400).height, 800);
});

test('key names map to virtual keys, xdotool spellings included', () => {
  assert.deepEqual(keyStroke('Return'), { vk: 0x0d, extended: false });
  assert.deepEqual(keyStroke('Page_Down'), { vk: 0x22, extended: true });
  assert.deepEqual(keyStroke('super'), { vk: 0x5b, extended: true });
  assert.deepEqual(keyStroke('F12'), { vk: 0x7b, extended: false });
  assert.deepEqual(keyStroke('a'), { vk: 0x41, extended: false });
  assert.deepEqual(keyStroke('7'), { vk: 0x37, extended: false });
  assert.throws(() => keyStroke('f25'), /Unknown key/);
  assert.throws(() => keyStroke('hyper'), /Unknown key/);
});

test('combinations split on plus, with plus itself as a key', () => {
  assert.deepEqual(keyCombo('ctrl+shift+t').map((stroke) => stroke.vk), [0x11, 0x10, 0x54]);
  assert.deepEqual(keyCombo('ctrl++').map((stroke) => stroke.vk), [0x11, 0xbb]);
  assert.deepEqual(keyCombo('+').map((stroke) => stroke.vk), [0xbb]);
  assert.throws(() => keyCombo(' '), /at least one key/);
});

test("the desktop window's processes are protected, the server's own children are not", () => {
  const tree = [
    { Pid: 1, Parent: 0, Name: 'node.exe' }, // launcher
    { Pid: 2, Parent: 1, Name: 'node.exe' }, // this server
    { Pid: 3, Parent: 1, Name: 'nw.exe' },
    { Pid: 4, Parent: 3, Name: 'nw.exe' },
    { Pid: 5, Parent: 2, Name: 'pwsh.exe' }, // a user terminal
    { Pid: 6, Parent: 5, Name: 'electron.exe' },
    { Pid: 7, Parent: 0, Name: 'notepad.exe' },
  ];
  assert.deepEqual([...protectedProcesses(tree, 2, 1)].sort(), [3, 4]);
  assert.equal(protectedProcesses(tree, 2, undefined).size, 0);
});

test('BasedCode titles are recognised, other apps mentioning it are not all caught', () => {
  assert.ok(basedCodeTitle('BasedCode'));
  assert.ok(basedCodeTitle('BasedCode - Google Chrome'));
  assert.ok(basedCodeTitle('BasedCode — Mozilla Firefox'));
  assert.ok(basedCodeTitle('BasedCode and 3 more pages - Personal - Microsoft Edge'));
  assert.ok(!basedCodeTitle('tools.ts - BasedCode - Visual Studio Code'));
  assert.ok(!basedCodeTitle('Untitled - Notepad'));
});
