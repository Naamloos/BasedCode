import type { AppEvent } from '../../shared/types';

const query = new URLSearchParams(location.search);
const stored = sessionStorage.getItem('basedcode.connection');
// Remote access (through a Cloudflare tunnel) carries its code in the hash and talks to the page's own origin.
const remoteCode = location.hash.slice(1);
const connection = query.has('token')
  ? { origin: query.get('api') ?? location.origin, token: query.get('token') ?? '' }
  : remoteCode
    ? { origin: location.origin, token: decodeURIComponent(remoteCode) }
    : stored
      ? (JSON.parse(stored) as { origin: string; token: string })
      : { origin: location.origin, token: '' };
const url = new URL(connection.origin);
const local = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:';
const remote =
  url.origin === location.origin &&
  url.protocol === 'https:' &&
  url.hostname.endsWith('.trycloudflare.com');
if (!local && !remote) throw new Error('BasedCode requires its local desktop backend.');
sessionStorage.setItem('basedcode.connection', JSON.stringify(connection));
history.replaceState(null, '', location.pathname);

export function mediaUrl(workspaceId: string, path: string): string {
  return `${connection.origin}/media?${new URLSearchParams({ workspaceId, path, token: connection.token })}`;
}

export function attachmentUrl(id: string): string {
  return `${connection.origin}/attachment?${new URLSearchParams({ id, token: connection.token })}`;
}

/** The agent browser's live MJPEG stream. Absent over remote access: tunnels buffer streamed responses. */
export function browserStreamUrl(chatId: string, session: number): string | undefined {
  if (remote) return undefined;
  return `${connection.origin}/browser-stream?${new URLSearchParams({ chatId, session: String(session), token: connection.token })}`;
}

let pendingMcpCall: Promise<unknown> = Promise.resolve();

export function rpc<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  if (method !== 'mcp.call') return request<T>(method, params);
  // Approval waits must leave HTTP connections available for state refreshes and approval decisions.
  const send = () => request<T>(method, params);
  const result = pendingMcpCall.then(send, send);
  pendingMcpCall = result.catch(() => undefined);
  return result;
}

async function request<T>(method: string, params: unknown): Promise<T> {
  const response = await fetch(`${connection.origin}/rpc`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  });
  const body = (await response.json()) as { result: T; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body.result;
}

const listeners = new Set<(event: AppEvent) => void>();
export function onEvent(listener: (event: AppEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dispatch(event: AppEvent): void {
  for (const listener of listeners) listener(event);
}

export function connectEvents(onConnection: (connected: boolean) => void): () => void {
  return remote ? pollEvents(onConnection) : streamEvents(onConnection);
}

function streamEvents(onConnection: (connected: boolean) => void): () => void {
  const source = new EventSource(
    `${connection.origin}/events?token=${encodeURIComponent(connection.token)}`,
  );
  source.onopen = () => onConnection(true);
  source.onerror = () => onConnection(false);
  source.onmessage = (message) => dispatch(JSON.parse(message.data) as AppEvent);
  return () => source.close();
}

/** Long-polls for events; Cloudflare quick tunnels don't deliver Server-Sent Events. */
function pollEvents(onConnection: (connected: boolean) => void): () => void {
  let stopped = false;
  let controller = new AbortController();
  void (async () => {
    let after = -1;
    let connected = false;
    while (!stopped) {
      try {
        const response = await fetch(`${connection.origin}/poll?after=${after}`, {
          headers: { Authorization: `Bearer ${connection.token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Event poll failed (${response.status}).`);
        const body = (await response.json()) as { seq: number; reset: boolean; events: AppEvent[] };
        // Reconnects and missed events behave like an SSE reconnect: the app reloads its state.
        if (!connected || body.reset) {
          connected = true;
          onConnection(true);
        }
        after = body.seq;
        for (const event of body.events) dispatch(event);
      } catch {
        if (stopped) return;
        if (connected) {
          connected = false;
          onConnection(false);
        }
        controller = new AbortController();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  })();
  return () => {
    stopped = true;
    controller.abort();
  };
}
