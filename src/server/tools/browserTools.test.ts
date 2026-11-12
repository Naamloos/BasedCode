import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync, zstdCompressSync } from "node:zlib";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createBrowserTools } from "./browserTools.js";
import { localBrowserUrl } from "./browserUrl.js";
import type { DefineTool, ToolContext, ToolServices } from "./definitions.js";

test("browser targets allow remote HTTP and WebSockets without credentials", () => {
  assert.equal(localBrowserUrl("http://localhost:3000/").hostname, "localhost");
  assert.equal(
    localBrowserUrl("https://example.com/").origin,
    "https://example.com",
  );
  assert.equal(localBrowserUrl("wss://example.com/socket").protocol, "wss:");
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://user:pass@localhost/",
  ]) {
    assert.throws(() => localBrowserUrl(url));
  }
});

test("browser tools navigate, fill, click and screenshot a local page", async () => {
  const server = createServer((_request, response) => {
    if (_request.url === "/redirect") {
      response.writeHead(302, {
        location: `http://127.0.0.2:${(server.address() as { port: number }).port}/blocked`,
      });
      response.end();
      return;
    }
    if (_request.url === "/encoded") {
      // Mimic servers that prefer zstd whenever the client advertises it.
      const body = Buffer.from("<title>Encoded page</title><p>Decoded marker</p>");
      const zstd = /zstd/.test(_request.headers["accept-encoding"] ?? "");
      response.writeHead(200, {
        "content-type": "text/html",
        "content-encoding": zstd ? "zstd" : "gzip",
      });
      response.end(zstd ? zstdCompressSync(body) : gzipSync(body));
      return;
    }
    if (_request.url === "/missing") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end(
      `<title>Browser test</title><label>Name<input id="name"></label>
       <button onclick="document.title=document.querySelector('#name').value; document.querySelector('#result').textContent='Done'">Go</button>
       <input id="check" type="checkbox"><select id="select"><option value="a">A</option><option value="b">B</option></select>
       <p id="result"></p><div style="height:1800px">Tall content</div>
       <script>const ws = new WebSocket('ws://' + location.host); ws.onmessage = e => console.log(e.data); console.error('diagnostic marker'); fetch('/missing'); setTimeout(()=>{throw new Error('page marker')}, 10)</script>`,
    );
  });
  server.on("upgrade", (request, socket) => {
    const accept = createHash("sha1")
      .update(
        request.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
    const message = Buffer.from("websocket marker");
    socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
    socket.on("error", () => {});
    socket.on("data", (data) => {
      if ((data[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0]));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  const context = {
    workspace: { id: "workspace" },
    run: { id: "run", chatId: "chat" },
    signal: controller.signal,
  } as ToolContext;
  const attachmentDirectory = await mkdtemp(
    join(tmpdir(), "basedcode-browser-"),
  );
  const saved: Record<string, unknown>[] = [];
  const previews: { active: boolean; image?: string; url?: string }[] = [];
  const frames: Buffer[] = [];
  let frameEnds = 0;
  let closeBrowser: (() => Promise<void>) | undefined;
  const services = {
    attachmentDirectory,
    store: {
      put: (_kind: string, value: Record<string, unknown>) => {
        saved.push(value);
        return value;
      },
      message: (
        _chat: string,
        _run: string,
        _role: string,
        _text: string,
        metadata: Record<string, unknown>,
      ) => saved.push(metadata),
    },
    events: {
      registerBrowser: async (_chatId: string, close: () => Promise<void>) => {
        await closeBrowser?.();
        closeBrowser = close;
      },
      closeBrowser: async () => {
        const close = closeBrowser;
        closeBrowser = undefined;
        await close?.();
      },
      publish: (type: string, data: { active: boolean; image?: string; url?: string }) => {
        if (type === "browser-preview") previews.push(data);
      },
      frame: (_chatId: string, image: Buffer) => frames.push(image),
      frameEnd: () => { frameEnds++; },
    },
    permissions: {
      ask: async (_workspace: string, _title: string, detail: string) => {
        if (detail.includes("127.0.0.2")) throw new Error("Denied origin");
      },
    },
  } as unknown as ToolServices;
  const define: DefineTool = (name, description, shape, handler) => ({
    name,
    description,
    shape,
    execute: async (args) => handler(z.object(shape).parse(args), () => {}),
  });
  let tools = createBrowserTools(context, services, define);
  const call = (name: string, args: Record<string, unknown> = {}) =>
    tools.find((tool) => tool.name === name)!.execute(args);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.match(
      JSON.stringify(
        await call("browser_navigate", {
          url: `http://127.0.0.1:${address.port}/`,
        }),
      ),
      /Browser test/,
    );
    const encoded = JSON.stringify(
      await call("browser_navigate", {
        url: `http://127.0.0.1:${address.port}/encoded`,
      }),
    );
    assert.match(encoded, /Encoded page/);
    assert.doesNotMatch(encoded, /\(µ\/ý/);
    assert.match(JSON.stringify(await call("browser_inspect")), /Decoded marker/);
    await call("browser_navigate", { url: `http://127.0.0.1:${address.port}/` });
    const inspection = (await call("browser_inspect")) as {
      elements: { ref: string; tag: string; name: string }[];
    };
    const input = inspection.elements.find(
      (item) => item.tag === "input" && item.name === "Name",
    );
    assert.ok(input);
    await call("browser_fill", { selector: input.ref, value: "Based" });
    await call("browser_interact", {
      action: "press",
      selector: input.ref,
      value: "End",
    });
    await call("browser_interact", { action: "hover", selector: "button" });
    await call("browser_interact", {
      action: "select",
      selector: "#select",
      value: "b",
    });
    await call("browser_interact", {
      action: "check",
      selector: "#check",
      checked: true,
    });
    await call("browser_wait", { kind: "element", selector: "#check:checked" });
    await call("browser_wait", {
      kind: "element",
      selector: "#select:has(option:checked[value=b])",
    });
    await call("browser_interact", { action: "scroll", y: 500 });
    await call("browser_interact", { action: "scroll", selector: "button" });
    assert.match(
      JSON.stringify(await call("browser_click", { selector: "button" })),
      /Based/,
    );
    assert.match(JSON.stringify(await call("browser_inspect")), /Based/);
    await call("browser_wait", { kind: "text", value: "Done" });
    await call("browser_wait", { kind: "url", value: "**/" });
    await call("browser_wait", { kind: "load" });
    await assert.rejects(
      call("browser_wait", {
        kind: "element",
        selector: "#absent",
        timeout: 50,
      }),
    );
    const diagnostics = JSON.stringify(
      await call("browser_logs", { clear: true }),
    );
    assert.match(diagnostics, /diagnostic marker/);
    assert.match(diagnostics, /page marker/);
    assert.match(diagnostics, /404/);
    assert.match(diagnostics, /websocket marker/);
    assert.deepEqual(await call("browser_logs"), { entries: [] });
    const resized = (await call("browser_control", {
      action: "resize",
      width: 800,
      height: 600,
    })) as { viewport: unknown };
    assert.deepEqual(resized.viewport, { width: 800, height: 600 });
    await call("browser_screenshot", { selector: "button" });
    await call("browser_screenshot", { fullPage: true });
    await call("browser_navigate", {
      url: `http://127.0.0.1:${address.port}/second`,
    });
    assert.match(
      JSON.stringify(await call("browser_control", { action: "back" })),
      /"url":"http:[^"]+\//,
    );
    await call("browser_control", { action: "forward" });
    await call("browser_control", { action: "reload" });
    const screenshot = (await call("browser_screenshot")) as {
      mediaType: string;
      attachmentId: string;
      data: string;
    };
    assert.equal(screenshot.mediaType, "image/png");
    assert.deepEqual(
      await readFile(join(attachmentDirectory, screenshot.attachmentId)),
      Buffer.from(screenshot.data, "base64"),
    );
    assert.ok(
      saved.some(
        (item) =>
          item.browserScreenshot === true && Array.isArray(item.attachments),
      ),
    );
    const deadline = Date.now() + 5000;
    while (!previews.some((frame) => frame.url?.startsWith("http:") && frame.image) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const frame = previews.find((item) => item.url?.startsWith("http:") && item.image);
    assert.ok(frame?.image, "live preview emits frames without screenshot calls");
    assert.equal(Buffer.from(frame.image, "base64").subarray(0, 2).toString("hex"), "ffd8");
    assert.ok(frames.length, "live stream receives screencast frames");
    assert.equal(frames[0].subarray(0, 2).toString("hex"), "ffd8");
    controller.abort();
    tools = createBrowserTools({
      ...context,
      run: { ...context.run, id: "next-run" },
      signal: new AbortController().signal,
    }, services, define);
    await call("browser_inspect");
    await call("browser_control", { action: "close" });
    assert.equal(previews.at(-1)?.active, false);
    assert.equal(frameEnds, 1, "live stream ends when the browser closes");
    const countAfterClose = previews.length;
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(previews.length, countAfterClose, "preview stops when browser closes");
    await assert.rejects(call("browser_inspect"), /Navigate/);
    await call("browser_navigate", {
      url: `http://127.0.0.1:${address.port}/`,
    });
    await assert.rejects(
      call("browser_navigate", {
        url: `http://127.0.0.1:${address.port}/redirect`,
      }),
    );
  } finally {
    controller.abort();
    assert.equal(previews.at(-1)?.active, true, "browser survives the run ending");
    await services.events.closeBrowser("chat");
    assert.equal(previews.at(-1)?.active, false);
    await rm(attachmentDirectory, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
