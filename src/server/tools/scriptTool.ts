import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';
import { z } from 'zod';
import type { Store } from '../storage/store.js';
import {
  isImageResult,
  type DefineTool,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
} from './definitions.js';

/** Tools a script may not reach: itself (no recursion) and the deferred loaders, since scripts call every tool directly. */
export const scriptExcludedTools = new Set(['run_script', 'load_tools', 'call_tool']);

const limits = {
  /** Interpreter memory. */
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  /** Uninterrupted JavaScript execution between tool calls; waiting on tools and approvals does not count. */
  sliceMs: 10_000,
  toolCalls: 200,
  outputCharacters: 20_000,
  /** JSON kept with store() per chat. */
  storeBytes: 256 * 1024,
};

/** What a tool result looks like inside a script: images become their description, never pixels. */
function scriptValue(result: unknown): unknown {
  if (isImageResult(result))
    return { path: result.path, mediaType: result.mediaType, bytes: result.bytes, text: result.text };
  return result;
}

function storedValues(store: Store, chatId: string): Record<string, unknown> {
  return store.all('scriptStore').find((record) => record.id === chatId)?.values ?? {};
}

/**
 * Runs JavaScript in QuickJS compiled to WebAssembly. The interpreter has no Node APIs, filesystem, network or
 * timers; its only ways out are the bridge functions below. Every tool call goes through the run's own tool
 * definitions, so validation, approvals, budgets, the secret guard, checkpoints and the chat's tool cards apply
 * exactly as for a direct call.
 */
export async function runScript(
  code: string,
  options: {
    tools: ToolDefinition[];
    store: Store;
    chatId: string;
    signal: AbortSignal;
  },
): Promise<{ output: string; result: unknown; toolCalls: number }> {
  const { tools, store, chatId, signal } = options;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  let sliceStart = Date.now();
  runtime.setInterruptHandler(() => signal.aborted || Date.now() - sliceStart > limits.sliceMs);
  const vm = runtime.newContext();

  const output: string[] = [];
  let outputLength = 0;
  let calls = 0;
  const pending = new Set<Promise<unknown>>();
  const values = { ...storedValues(store, chatId) };
  let valuesChanged = false;

  /** Runs queued promise jobs inside the interpreter, timing each slice. */
  const pump = () => {
    sliceStart = Date.now();
    const result = runtime.executePendingJobs();
    if (result.error) result.error.dispose();
  };
  const fn = (name: string, body: (...args: QuickJSHandle[]) => QuickJSHandle | undefined) => {
    const handle = vm.newFunction(name, body);
    vm.setProp(vm.global, name, handle);
    handle.dispose();
  };

  try {
    fn('__emit', (text) => {
      const line = vm.getString(text);
      if (outputLength < limits.outputCharacters) output.push(line);
      outputLength += line.length + 1;
      return undefined;
    });
    fn('__store', (key, json) => {
      const name = vm.getString(key);
      const encoded = vm.getString(json);
      const next = { ...values, [name]: JSON.parse(encoded) as unknown };
      if (JSON.stringify(next).length > limits.storeBytes)
        throw new Error(`store() keeps at most ${limits.storeBytes / 1024} KiB per chat.`);
      values[name] = next[name];
      valuesChanged = true;
      return undefined;
    });
    fn('__load', (key) => {
      const value = values[vm.getString(key)];
      return value === undefined ? vm.undefined : vm.newString(JSON.stringify(value));
    });
    fn('__call', (nameHandle, argsHandle) => {
      const name = vm.getString(nameHandle);
      const args = JSON.parse(vm.getString(argsHandle)) as Record<string, unknown>;
      const call = (async () => {
        const tool = byName.get(name);
        if (!tool)
          throw new Error(
            scriptExcludedTools.has(name)
              ? `${name} cannot be called from a script.`
              : `No tool named "${name}". See ALL_TOOLS.`,
          );
        if (++calls > limits.toolCalls) throw new Error(`A script may make at most ${limits.toolCalls} tool calls.`);
        signal.throwIfAborted();
        return JSON.stringify(scriptValue(await tool.execute(args)) ?? null);
      })();
      const promise = vm.newPromise(call.then((json) => vm.newString(json)));
      // Pump before the script's own cleanup sees the call as done, so jobs never run on a disposed runtime.
      const settled = promise.settled.then(pump);
      pending.add(settled);
      void settled.finally(() => pending.delete(settled));
      return promise.handle;
    });
    const catalog = tools.map((tool) => ({ name: tool.name, description: tool.description }));
    vm.unwrapResult(
      vm.evalCode(`
        const __format = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        globalThis.ALL_TOOLS = ${JSON.stringify(catalog)};
        globalThis.tools = new Proxy({}, {
          get: (_, name) => (args = {}) => __call(String(name), JSON.stringify(args)).then((json) => JSON.parse(json)),
        });
        globalThis.text = (...parts) => { __emit(parts.map(__format).join(' ')); };
        globalThis.console = { log: text, info: text, warn: text, error: text };
        globalThis.store = (key, value) => { __store(String(key), JSON.stringify(value ?? null)); };
        globalThis.load = (key) => { const json = __load(String(key)); return json === undefined ? undefined : JSON.parse(json); };
      `),
    ).dispose();

    sliceStart = Date.now();
    const promiseHandle = vm.unwrapResult(vm.evalCode(`(async () => {\n${code}\n})()`, 'script.js'));
    const settled = vm.resolvePromise(promiseHandle);
    promiseHandle.dispose();
    pump();
    const outcome = await settled;
    // A tool call the script started but did not await still runs to its end: it may have side effects.
    while (pending.size) await Promise.all(pending);
    if (valuesChanged)
      store.put('scriptStore', { id: chatId, values });
    if (outcome.error) {
      const error = vm.dump(outcome.error) as { name?: string; message?: string; stack?: string } | string;
      outcome.error.dispose();
      const message = typeof error === 'string' ? error : `${error.name ?? 'Error'}: ${error.message ?? ''}`;
      signal.throwIfAborted();
      throw new Error(
        `Script error: ${message}${output.length ? `\nOutput before the error:\n${output.join('\n')}` : ''}`,
      );
    }
    const result = vm.dump(outcome.value) as unknown;
    outcome.value.dispose();
    return {
      output: output.join('\n') + (outputLength > limits.outputCharacters ? '\n[output cut]' : ''),
      result,
      toolCalls: calls,
    };
  } finally {
    while (pending.size) await Promise.all(pending);
    disposeAll(vm);
  }

  function disposeAll(context: QuickJSContext) {
    context.dispose();
    runtime.dispose();
  }
}

export function createScriptTool(
  context: ToolContext,
  services: Pick<ToolServices, 'store'>,
  definition: DefineTool,
): ToolDefinition[] {
  return [
    definition(
      'run_script',
      `Run JavaScript that calls your other tools, to combine many calls into one step: loops over files, parallel reads with Promise.all, filtering big results before you see them. Inside the script:
- await tools.<name>(args) calls any tool (deferred ones too, without load_tools) and resolves to its result; a failed or denied call throws.
- ALL_TOOLS lists every tool's name and description.
- text(...values) or console.log adds lines to the output you get back; return <value> sends a result.
- store(key, value) and load(key) keep JSON values across scripts in this chat.
The interpreter is sandboxed: no require, fs, network, timers or process. Each tool call is approved, checkpointed and shown to the user exactly as a direct call. Limits: ${limits.toolCalls} tool calls, ${limits.sliceMs / 1000}s of JavaScript between calls, ${limits.memoryBytes / 1024 / 1024} MiB memory.`,
      {
        code: z.string().min(1).max(100_000).describe('Body of an async function: use await, and return the result.'),
      },
      async ({ code }) => {
        const tools = context.scriptTools?.();
        if (!tools) throw new Error('Scripts are not available in this run.');
        const { output, result, toolCalls } = await runScript(code, {
          tools: tools.filter((tool) => !scriptExcludedTools.has(tool.name)),
          store: services.store,
          chatId: context.run.chatId,
          signal: context.signal,
        });
        return { toolCalls, ...(output ? { output } : {}), ...(result !== undefined ? { result } : {}) };
      },
    ),
  ];
}
