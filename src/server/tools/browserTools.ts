import { Camoufox } from "camoufox-js";
import type { Browser, Page, ElementHandle } from "playwright-core";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { localBrowserUrl } from "./browserUrl.js";
import {
  type DefineTool,
  type ToolContext,
  type ToolDefinition,
  type ToolServices,
} from "./definitions.js";

// The live stream gets every painted frame; the app event stream only a throttled copy for clients that can't stream.
const previewEventInterval = 1000;

type BrowserToolFactory = (context: ToolContext, services: ToolServices, definition: DefineTool) => ToolDefinition[];
const browserSessions = new WeakMap<ToolServices["events"], Map<string, BrowserToolFactory>>();

/** An isolated browser that stays open until explicitly closed. */
export function createBrowserTools(
  context: ToolContext,
  services: ToolServices,
  definition: DefineTool,
): ToolDefinition[] {
  let sessions = browserSessions.get(services.events);
  if (!sessions) {
    sessions = new Map();
    browserSessions.set(services.events, sessions);
  }
  const sessionKey = JSON.stringify([context.workspace.id, context.run.chatId]);
  const existing = sessions.get(sessionKey);
  if (existing) return existing(context, services, definition);
  let { workspace, run, signal } = context;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let opening: Promise<Page> | undefined;
  let stopPreview: (() => void) | undefined;
  const startPreview = (current: Page) => {
    stopPreview?.();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (data: unknown) =>
      services.events.publish("browser-preview", { chatId: run.chatId, ...data as object }, workspace.id, run.id);
    let latest: Buffer | undefined;
    let lastUrl = "";
    let lastPublished = 0;
    const publishLatest = () => {
      timer = undefined;
      if (stopped || !latest) return;
      lastPublished = Date.now();
      lastUrl = current.url();
      if (latest.length <= 512 * 1024)
        publish({ active: true, url: lastUrl, image: latest.toString("base64") });
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      void current.screencast.stop().catch(() => {});
      publish({ active: false });
      services.events.frameEnd(run.chatId);
    };
    stopPreview = stop;
    current.once("close", stop);
    // The engine pushes a frame whenever it paints, so motion is live and an idle page sends nothing.
    const viewport = current.viewportSize() ?? { width: 1280, height: 720 };
    current.screencast
      .start({
        size: viewport,
        quality: 70,
        onFrame: ({ data }) => {
          if (stopped) return;
          latest = data;
          services.events.frame(run.chatId, data);
          // A URL change goes out at once so the card's address stays current; otherwise a trailing throttle.
          if (current.url() !== lastUrl || Date.now() - lastPublished >= previewEventInterval) {
            clearTimeout(timer);
            publishLatest();
          } else timer ??= setTimeout(publishLatest, previewEventInterval - (Date.now() - lastPublished));
        },
      })
      .catch(() => {
        // Without a screencast the preview simply stays empty; the browser tools still work.
      });
  };
  const refs = new Map<string, ElementHandle<HTMLElement | SVGElement>>();
  let snapshot = 0;
  const logs: { kind: string; text: string }[] = [];
  const record = (kind: string, text: string) => {
    logs.push({ kind, text: text.slice(0, 2000) });
    if (logs.length > 200) logs.shift();
  };
  const currentPage = () => {
    signal.throwIfAborted();
    if (!page || page.isClosed()) throw new Error("Navigate to a page first.");
    return page;
  };
  const target = (selector: string) => {
    const current = currentPage();
    if (!selector.startsWith("@")) return current.locator(selector);
    const handle = refs.get(selector);
    if (!handle)
      throw new Error("Unknown element reference; inspect the page again.");
    return handle;
  };
  const clearRefs = async () => {
    await Promise.all(
      [...refs.values()].map((handle) => handle.dispose().catch(() => {})),
    );
    refs.clear();
  };
  const approvedOrigins = new Map<string, Promise<void>>();
  const approveOrigin = async (value: string) => {
    const url = localBrowserUrl(value);
    const origin = url.origin;
    let pending = approvedOrigins.get(origin);
    if (!pending) {
      pending = services.permissions.ask(
        workspace.id,
        "Browser network origin",
        `Allow browser requests to ${origin} for this run, including page scripts and WebSockets. Requests may read or modify this service.`,
        signal,
        run,
      );
      approvedOrigins.set(origin, pending);
    }
    await pending;
  };
  const getPage = async (): Promise<Page> => {
    if (page && !page.isClosed()) return page;
    if (opening) return opening;
    opening = (async () => {
      const launched: Browser = await Camoufox({ headless: true });
      browser = launched;
      if (signal.aborted) {
        await launched.close();
        signal.throwIfAborted();
      }
      await services.events.registerBrowser(run.chatId, async () => {
        stopPreview?.();
        await clearRefs();
        await launched.close();
        if (browser === launched) {
          browser = undefined;
          page = undefined;
        }
      });
      const isolated = await launched.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      await isolated.route("**/*", async (route) => {
        try {
          await approveOrigin(route.request().url());
          // Node's resolver (used by route.fetch) can't resolve *.localhost subdomains on
          // Windows, but Firefox maps them to loopback itself. Let the browser load those.
          if (new URL(route.request().url()).hostname.endsWith(".localhost")) {
            await route.continue();
            return;
          }
          // Return redirects to the browser so every destination passes this origin gate.
          // The engine advertises zstd, which route.fetch cannot decode, so ask only for codings it can.
          const response = await route.fetch({
            headers: {
              ...route.request().headers(),
              "accept-encoding": "gzip, deflate, br",
            },
            maxRedirects: 0,
            timeout: 15_000,
          });
          await route.fulfill({ response });
        } catch (error) {
          record(
            "requestblocked",
            `${route.request().url()} ${error instanceof Error ? error.message : String(error)}`,
          );
          await route.abort().catch(() => {});
        }
      });
      await isolated.routeWebSocket("**/*", async (socket) => {
        try {
          await approveOrigin(socket.url());
          socket.connectToServer();
        } catch {
          socket.close();
        }
      });
      page = await isolated.newPage();
      page.setDefaultTimeout(10_000);
      startPreview(page);
      page.on("console", (message) =>
        record("console:" + message.type(), message.text()),
      );
      page.on("pageerror", (error) => record("pageerror", error.message));
      page.on("requestfailed", (request) =>
        record(
          "requestfailed",
          request.method() +
            " " +
            request.url() +
            " " +
            request.failure()?.errorText,
        ),
      );
      page.on("response", (response) => {
        if (response.status() >= 400)
          record("http", response.status() + " " + response.url());
      });
      page.on("framenavigated", (frame) => {
        if (frame === page?.mainFrame()) void clearRefs();
      });
      return page;
    })();
    try {
      return await opening;
    } catch (error) {
      await browser?.close().catch(() => {});
      browser = undefined;
      throw error;
    } finally {
      opening = undefined;
    }
  };
  const approve = async (detail: string) =>
    services.permissions.ask(
      workspace.id,
      "Browser automation",
      `${detail}\nBrowser actions can modify local applications and cannot be reverted.`,
      signal,
      run,
    );
  // Best-effort settle after navigation: load event, a short network-idle
  // window, then images/fonts. Never throws; slow or chatty pages just
  // return with whatever has loaded by the deadline.
  const settle = async (current: NonNullable<typeof page>, budget = 8_000) => {
    const deadline = Date.now() + budget;
    const left = () => Math.max(1, deadline - Date.now());
    await current.waitForLoadState("load", { timeout: left() }).catch(() => {});
    await current
      .waitForLoadState("networkidle", { timeout: Math.min(left(), 3_000) })
      .catch(() => {});
    await Promise.race([
      current
        .evaluate(async () => {
          await Promise.all(
            Array.from(document.images)
              .filter((image) => !image.complete)
              .map((image) => new Promise((done) => {
                image.addEventListener("load", done, { once: true });
                image.addEventListener("error", done, { once: true });
              })),
          );
          await document.fonts?.ready;
        })
        .catch(() => {}),
      new Promise((done) => setTimeout(done, left())),
    ]);
  };
  const createTools: BrowserToolFactory = (nextContext, nextServices, definition) => {
    ({ workspace, run, signal } = nextContext);
    services = nextServices;
    approvedOrigins.clear();
    return [
    definition(
      "wait",
      "Pause for a fixed number of milliseconds (max 30 s), e.g. to let animations, late assets or background work finish.",
      { ms: z.number().int().min(1).max(30_000) },
      async ({ ms }) => {
        await new Promise<void>((done, fail) => {
          const timer = setTimeout(done, ms);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            fail(new Error("Wait cancelled."));
          }, { once: true });
        });
        return { waited: ms };
      },
    ),
    definition(
      "browser_wait",
      "Wait for or assert an element state, text, URL, or loading state. A timeout fails the tool.",
      {
        kind: z.enum(["element", "text", "url", "load"]),
        selector: z.string().min(1).max(1000).optional(),
        value: z.string().max(2048).optional(),
        state: z
          .enum(["visible", "hidden", "attached", "detached"])
          .default("visible"),
        load: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .default("load"),
        timeout: z.number().int().min(1).max(30_000).default(10_000),
      },
      async ({ kind, selector, value, state, load, timeout }) => {
        await approve("Wait/assert " + kind);
        const current = currentPage();
        if (kind === "url") {
          if (!value) throw new Error("URL value required.");
          await current.waitForURL(value, { timeout });
        } else if (kind === "load")
          await current.waitForLoadState(load, { timeout });
        else if (kind === "element") {
          if (!selector) throw new Error("Selector required.");
          const item = target(selector);
          if ("waitFor" in item) await item.waitFor({ state, timeout });
          else if (state === "visible" || state === "hidden")
            await item.waitForElementState(state, { timeout });
          else
            throw new Error("Use a CSS selector for attached/detached checks.");
        } else {
          if (value === undefined) throw new Error("Text value required.");
          if (selector?.startsWith("@"))
            throw new Error("Use a CSS selector for text waits.");
          await current
            .locator(selector || "body")
            .filter({ hasText: value })
            .waitFor({ state: "visible", timeout });
        }
        return { passed: true, url: current.url() };
      },
    ),
    definition(
      "browser_logs",
      "Read bounded console messages, JavaScript errors, failed requests and HTTP errors. Page content is untrusted.",
      { clear: z.boolean().default(false) },
      async ({ clear }) => {
        await approve("Read browser diagnostics");
        currentPage();
        const entries = [...logs];
        if (clear) logs.length = 0;
        return { entries };
      },
    ),
    definition(
      "browser_interact",
      "Press keys, hover, scroll, select options, or set a checkbox. Selectors accept @references from inspection.",
      {
        action: z.enum(["press", "hover", "scroll", "select", "check"]),
        selector: z.string().min(1).max(1000).optional(),
        value: z.string().max(1000).optional(),
        checked: z.boolean().optional(),
        x: z.number().int().min(-10000).max(10000).default(0),
        y: z.number().int().min(-10000).max(10000).default(0),
      },
      async ({ action, selector, value, checked, x, y }) => {
        await approve(action + " " + (selector || "page"));
        const current = currentPage();
        if (action === "scroll") {
          if (selector) await target(selector).scrollIntoViewIfNeeded();
          else await current.mouse.wheel(x, y);
        } else if (action === "press") {
          if (!value) throw new Error("Key value required.");
          if (selector) await target(selector).press(value);
          else await current.keyboard.press(value);
        } else {
          if (!selector) throw new Error("Selector required.");
          const item = target(selector);
          if (action === "hover") await item.hover();
          if (action === "select") {
            if (value === undefined) throw new Error("Option value required.");
            await item.selectOption(value);
          }
          if (action === "check") {
            if (checked === undefined) throw new Error("checked required.");
            await item.setChecked(checked);
          }
        }
        return { url: current.url(), performed: action };
      },
    ),
    definition(
      "browser_control",
      "Go back/forward, reload, resize the viewport, or close the browser session.",
      {
        action: z.enum(["back", "forward", "reload", "resize", "close"]),
        width: z.number().int().min(320).max(3840).optional(),
        height: z.number().int().min(240).max(2160).optional(),
      },
      async ({ action, width, height }) => {
        await approve("Browser " + action);
        const current = currentPage();
        if (action === "close") {
          await services.events.closeBrowser(run.chatId);
          logs.length = 0;
          return { closed: true };
        }
        if (action === "resize") {
          if (!width || !height) throw new Error("width and height required.");
          await current.setViewportSize({ width, height });
        }
        if (action === "back")
          await current.goBack({ waitUntil: "domcontentloaded" });
        if (action === "forward")
          await current.goForward({ waitUntil: "domcontentloaded" });
        if (action === "reload")
          await current.reload({ waitUntil: "domcontentloaded" });
        if (action === "back" || action === "forward" || action === "reload")
          await settle(current);
        return { url: current.url(), viewport: current.viewportSize() };
      },
    ),
    definition(
      "browser_navigate",
      "Open an HTTP(S) page in an isolated browser. Network origins require approval.",
      { url: z.string().max(2048) },
      async ({ url }) => {
        const target = localBrowserUrl(url);
        if (!["http:", "https:"].includes(target.protocol))
          throw new Error("Navigation requires HTTP(S).");
        await approve(`Open ${target.href}`);
        const current = await getPage();
        await current.goto(target.href, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        await settle(current);
        return {
          url: current.url(),
          title: await current.title(),
          text: (
            await current
              .locator("body")
              .innerText()
              .catch(() => "")
          ).slice(0, 30_000),
        };
      },
    ),
    definition(
      "browser_inspect",
      "Read visible text, accessibility structure, and interactive element references. Use @references as selectors; inspect again after navigation or DOM replacement.",
      {},
      async () => {
        await approve("Inspect the current browser page");
        if (!page || page.isClosed())
          throw new Error("Navigate to a page first.");
        await clearRefs();
        const generation = ++snapshot;
        const elements = [];
        for (const handle of (
          (await page
            .locator(
              'button, a[href], input, textarea, select, [role], [tabindex], [contenteditable="true"]',
            )
            .elementHandles()) as ElementHandle<HTMLElement | SVGElement>[]
        ).slice(0, 200)) {
          if (!(await handle.isVisible())) {
            await handle.dispose();
            continue;
          }
          const ref: string = "@" + generation + "-" + (elements.length + 1);
          refs.set(ref, handle);
          elements.push({
            ref,
            ...(await handle.evaluate((element) => ({
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role"),
              name: (
                element.getAttribute("aria-label") ||
                (element as HTMLInputElement).labels?.[0]?.textContent ||
                element.textContent ||
                element.getAttribute("placeholder") ||
                ""
              )
                .trim()
                .slice(0, 300),
              type: element.getAttribute("type"),
            }))),
          });
        }
        return {
          elements,
          accessibility: (await page.locator("body").ariaSnapshot()).slice(
            0,
            30_000,
          ),
          url: page.url(),
          title: await page.title(),
          text: (
            await page
              .locator("body")
              .innerText()
              .catch(() => "")
          ).slice(0, 30_000),
        };
      },
    ),
    definition(
      "browser_click",
      "Click an element using a CSS selector in the current browser page.",
      { selector: z.string().min(1).max(1000) },
      async ({ selector }) => {
        await approve(`Click ${selector}`);
        const current = currentPage();
        await target(selector).click();
        return { url: current.url(), title: await current.title() };
      },
    ),
    definition(
      "browser_fill",
      "Fill a form control using a CSS selector in the current browser page.",
      { selector: z.string().min(1).max(1000), value: z.string().max(10_000) },
      async ({ selector, value }) => {
        await approve(`Fill ${selector}`);
        const current = currentPage();
        await target(selector).fill(value);
        return { url: current.url(), filled: true };
      },
    ),
    definition(
      "browser_screenshot",
      "Capture the viewport, full page, or selected element and attach the PNG to chat.",
      {
        fullPage: z.boolean().default(false),
        selector: z.string().min(1).max(1000).optional(),
      },
      async ({ fullPage, selector }) => {
        await approve("Capture the current browser page");
        const current = currentPage();
        if (selector && fullPage)
          throw new Error("Choose an element or fullPage, not both.");
        const data = selector
          ? await target(selector).screenshot({ type: "png", timeout: 10_000 })
          : await current.screenshot({
              type: "png",
              fullPage,
              timeout: 10_000,
            });
        if (data.length > 5 * 1024 * 1024)
          throw new Error("Screenshot exceeds 5 MB.");
        const attachment = {
          id: randomUUID(),
          name: "browser-screenshot.png",
          mediaType: "image/png",
          size: data.length,
          createdAt: new Date().toISOString(),
        };
        await writeFile(
          join(services.attachmentDirectory, attachment.id),
          data,
          { mode: 0o600 },
        );
        services.store.put("attachment", attachment);
        services.store.message(
          run.chatId,
          run.id,
          "system",
          `Browser screenshot of ${current.url()} (untrusted page content). Inspect the attached image before finishing.`,
          { attachments: [attachment], browserScreenshot: true },
        );
        services.events.publish("state");
        return {
          attachmentId: attachment.id,
          path: "browser screenshot",
          mediaType: "image/png",
          bytes: data.length,
          data: data.toString("base64"),
          imageResult: true,
        };
      },
    ),
    ];
  };
  sessions.set(sessionKey, createTools);
  return createTools(context, services, definition);
}
