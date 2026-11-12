/* global nw */
const environment = require('node:process').env;
const apiOrigin = environment.BASEDCODE_API;
const authToken = environment.BASEDCODE_AUTH;
const uiUrl = new URL(environment.BASEDCODE_UI);
uiUrl.searchParams.set('api', apiOrigin);
uiUrl.searchParams.set('token', authToken);
document.getElementById('application').src = uiUrl.href;

// Node's HTTP client, not window.fetch: fetch from this chrome-extension:// page sends an Origin header and a
// CORS preflight the backend rejects, which silently broke "Browse folders…" and the quit check.
const http = require('node:http');
function rpc(method, params = {}) {
  const payload = JSON.stringify({ method, params });
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${apiOrigin}/rpc`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          try {
            const body = JSON.parse(text);
            if (response.statusCode !== 200)
              reject(new Error(body.error ?? 'Desktop request failed.'));
            else resolve(body.result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

function handleEvent(event) {
  if (event.type === 'open-url' && typeof event.data === 'string') {
    const url = new URL(event.data);
    if (['http:', 'https:'].includes(url.protocol)) nw.Shell.openExternal(url.href);
  }
}
// Server-sent events over Node's HTTP client for the same Origin reason as rpc(); reconnects if the stream drops.
let eventRequest;
let streamClosed = false;
function connectEvents() {
  eventRequest = http.get(
    `${apiOrigin}/events`,
    { headers: { Authorization: `Bearer ${authToken}` } },
    (response) => {
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n');
          if (data) {
            try {
              handleEvent(JSON.parse(data));
            } catch {
              /* Ignore malformed events. */
            }
          }
        }
      });
      response.on('end', () => {
        if (!streamClosed) setTimeout(connectEvents, 1000);
      });
    },
  );
  eventRequest.on('error', () => {
    if (!streamClosed) setTimeout(connectEvents, 1000);
  });
}
connectEvents();
const stream = {
  close() {
    streamClosed = true;
    eventRequest?.destroy();
  },
};
// No native menubar: it renders as a light OS strip above the dark UI. Ctrl+O is handled inside the app.
const windowInstance = nw.Window.get();

// The window is frameless; the app draws its own title bar. The app frame has no NW.js access, so it asks
// for window actions by postMessage. Only messages from that frame and its origin, with a fixed command, are honored.
const application = document.getElementById('application');
const dragLayer = document.getElementById('drag-regions');
let maximized = false;
function postWindowState() {
  application.contentWindow?.postMessage(
    { source: 'basedcode-shell', type: 'window-state', maximized },
    uiUrl.origin,
  );
}
// nwfaketop hides this shell from the app (its window.parent is itself), so the shell starts the conversation on every load.
// A single post can land before the app's listener exists (then the app thinks it runs in a browser tab and uses its
// in-app pickers), so keep announcing until the app sends its first message back.
let appAnswered = false;
let announceTimer;
application.addEventListener('load', () => {
  appAnswered = false;
  clearInterval(announceTimer);
  postWindowState();
  let tries = 0;
  announceTimer = setInterval(() => {
    if (appAnswered || ++tries > 40) clearInterval(announceTimer);
    else postWindowState();
  }, 250);
});
windowInstance.on('maximize', () => {
  maximized = true;
  postWindowState();
});
windowInstance.on('restore', () => {
  maximized = false;
  postWindowState();
});
windowInstance.on('unmaximize', () => {
  maximized = false;
  postWindowState();
});
/** Shows the native folder dialog and reports the chosen folder (or null when cancelled) to the app frame. */
function pickFolder() {
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('nwdirectory', '');
  let answered = false;
  const answer = (path) => {
    if (answered) return;
    answered = true;
    application.contentWindow?.postMessage(
      { source: 'basedcode-shell', type: 'folder-picked', path },
      uiUrl.origin,
    );
  };
  input.addEventListener('change', () => answer(input.value || null));
  input.addEventListener('cancel', () => answer(null));
  input.click();
}
/** Shows the native multi-file dialog and reports the chosen paths (empty when cancelled) to the app frame. */
function pickFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  let answered = false;
  const answer = (paths) => {
    if (answered) return;
    answered = true;
    application.contentWindow?.postMessage(
      { source: 'basedcode-shell', type: 'files-picked', paths },
      uiUrl.origin,
    );
  };
  // NW.js exposes the absolute path on each File.
  input.addEventListener('change', () =>
    answer([...(input.files ?? [])].map((file) => file.path).filter(Boolean)),
  );
  input.addEventListener('cancel', () => answer([]));
  input.click();
}
window.addEventListener('message', (event) => {
  if (event.source !== application.contentWindow || event.origin !== uiUrl.origin) return;
  const message = event.data;
  if (message?.source !== 'basedcode-app') return;
  appAnswered = true;
  if (message.type === 'close-decision' && checkingClose) {
    checkingClose = false;
    if (message.approved === true) {
      stream.close();
      windowInstance.close(true);
    }
  }
  if (message.type === 'window-command') {
    if (message.command === 'minimize') windowInstance.minimize();
    else if (message.command === 'toggle-maximize') {
      if (maximized) windowInstance.restore();
      else windowInstance.maximize();
    } else if (message.command === 'close') windowInstance.close();
    else if (message.command === 'reload') windowInstance.reload();
    else if (message.command === 'hello') postWindowState();
  }
  // The app frame has no desktop access, so it asks the shell to show the native folder dialog.
  if (message.type === 'pick-folder') pickFolder();
  if (message.type === 'pick-files') pickFiles();
  // Drag areas must live in this top-level frame: Chromium ignores app-region inside the embedded app frame.
  if (message.type === 'drag-regions' && Array.isArray(message.rects)) {
    dragLayer.replaceChildren(
      ...message.rects
        .slice(0, 12)
        .filter((rect) => [rect?.x, rect?.y, rect?.width, rect?.height].every(Number.isFinite))
        .map((rect) => {
          const region = document.createElement('div');
          region.className = 'drag-region';
          Object.assign(region.style, {
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${Math.max(0, rect.width)}px`,
            height: `${Math.max(0, rect.height)}px`,
          });
          return region;
        }),
    );
  }
});
let checkingClose = false;
windowInstance.on('close', async () => {
  if (checkingClose) return;
  checkingClose = true;
  try {
    const state = await rpc('state');
    const active =
      state.runs.some((run) =>
        ['running', 'paused', 'queued', 'awaiting_approval'].includes(run.status),
      ) || state.terminals.some((terminal) => terminal.status === 'running');
    if (active) {
      application.contentWindow?.postMessage(
        {
          source: 'basedcode-shell',
          type: 'confirm-close',
          detail: 'Active agents or terminals will stop. Quit BasedCode?',
        },
        uiUrl.origin,
      );
      return;
    }
    stream.close();
    windowInstance.close(true);
  } catch (error) {
    application.contentWindow?.postMessage(
      {
        source: 'basedcode-shell',
        type: 'confirm-close',
        detail: `Cannot contact the backend: ${error.message}\nQuit anyway?`,
      },
      uiUrl.origin,
    );
  }
});
