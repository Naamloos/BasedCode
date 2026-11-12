import { createHash } from 'node:crypto';
import { Camoufox } from 'camoufox-js';
import { createServer, type ServerResponse } from 'node:http';
const viewers = new Set<ServerResponse>();
let frames = 0;
const server = createServer((req, res) => {
  if (req.url === '/stream') {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store' });
    res.write('--frame\r\n');
    viewers.add(res);
    res.on('close', () => viewers.delete(res));
  } else { res.setHeader('Content-Type', 'text/html'); res.end('<img src="/stream"><canvas width="640" height="400"></canvas>'); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No address');
const browser = await Camoufox({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const source = await context.newPage();
  await source.screencast.start({size: {width:640,height:400}, quality:70, onFrame: ({data}) => {
    frames++;
    for (const res of viewers) {
      res.write('Content-Type: image/jpeg\r\nContent-Length: '+data.length+'\r\n\r\n');
      res.write(data);
      res.write('\r\n--frame\r\n');
    }
  }});
  await source.setContent('<style>body{animation:c 1s linear infinite}@keyframes c{from{background:red}to{background:blue}}</style>');
  const viewer = await context.newPage();
  await viewer.goto('http://127.0.0.1:'+address.port, {waitUntil:'domcontentloaded'});
  const colors = await viewer.evaluate(async () => {
    const img = document.querySelector('img')!;
    const ctx = document.querySelector('canvas')!.getContext('2d')!;
    const samples: string[] = [];
    for (let i=0;i<20;i++) {
      await new Promise(r=>setTimeout(r,100));
      if (img.naturalWidth) {ctx.drawImage(img,0,0); samples.push(Array.from(ctx.getImageData(0,0,1,1).data).join(','));}
    }
    return { samples:samples.length, unique:new Set(samples).size };
  });
  const shots = new Set<string>();
  for(let i=0;i<8;i++) { await viewer.waitForTimeout(150); shots.add(createHash('sha256').update(await viewer.screenshot()).digest('hex')); }
  console.log(JSON.stringify({frames, ...colors, uniqueScreenshots:shots.size}));
} finally {
  await browser.close();
  for (const res of viewers) res.end();
  server.close();
}
