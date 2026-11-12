import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanOutput, parseProblems } from './output.js';

test('cleanOutput strips CSI, OSC and carriage-return redraws', () => {
  assert.equal(cleanOutput('\u001b[31mred\u001b[0m\r\n'), 'red\n');
  assert.equal(cleanOutput('\u001b]0;title\u0007hello'), 'hello');
  assert.equal(cleanOutput('10%\r50%\r100%\ndone'), '100%\ndone');
  assert.equal(cleanOutput('a\u001b[?25lb\u001b[2Kc'), 'abc');
});

test('parseProblems reads tsc, generic and eslint stylish formats', () => {
  const tsc = parseProblems('src/a.ts(3,7): error TS2322: Type mismatch.');
  assert.deepEqual(tsc, [{ file: 'src/a.ts', line: 3, column: 7, severity: 'error', message: 'TS2322: Type mismatch.' }]);
  const pretty = parseProblems('\u001b[96msrc/b.ts\u001b[0m:10:2 - \u001b[91merror\u001b[0m TS1005: \';\' expected.');
  assert.equal(pretty[0].file, 'src/b.ts');
  assert.equal(pretty[0].line, 10);
  const generic = parseProblems('main.c:4:1: warning: unused');
  assert.equal(generic[0].severity, 'warning');
  const stylish = parseProblems('C:\\repo\\backend\\x.ts\n  12:5  error  \'y\' is unused  no-unused-vars\n\n1 problem');
  assert.deepEqual(stylish, [{ file: 'C:\\repo\\backend\\x.ts', line: 12, column: 5, severity: 'error', message: '\'y\' is unused no-unused-vars' }]);
  assert.deepEqual(parseProblems('all good'), []);
});
