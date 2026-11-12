// Throwaway probe: does Camoufox's Juggler deliver live screencast frames through Playwright's page.screencast?
import { Camoufox } from "camoufox-js";

const html = `<style>body{margin:0;background:#111}div{width:120px;height:120px;background:#e83;animation:spin 1s linear infinite;margin:200px auto}@keyframes spin{to{transform:rotate(360deg)}}</style><div></div>`;

const browser = await Camoufox({ headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.setContent(html);
  const stamps: number[] = [];
  let bytes = 0;
  const started = Date.now();
  const handle = await page.screencast.start({
    size: { width: 960, height: 600 },
    quality: 70,
    onFrame: ({ data, viewportWidth, viewportHeight }) => {
      if (!stamps.length) console.log(`first frame after ${Date.now() - started} ms, viewport ${viewportWidth}x${viewportHeight}`);
      stamps.push(Date.now());
      bytes += data.length;
    },
  });
  await page.waitForTimeout(3000);
  await page.screencast.stop();
  void handle;
  const span = stamps.length > 1 ? (stamps.at(-1)! - stamps[0]) / 1000 : 0;
  console.log(`frames=${stamps.length} fps=${span ? (stamps.length / span).toFixed(1) : "n/a"} avgKB=${stamps.length ? (bytes / stamps.length / 1024).toFixed(1) : 0}`);
} catch (error) {
  console.log("SCREENCAST FAILED:", error instanceof Error ? error.message : error);
} finally {
  await browser.close();
}
