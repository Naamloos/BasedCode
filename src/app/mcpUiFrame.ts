import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  UIResourceRenderer, remoteButtonDefinition, remoteTextDefinition,
  remoteStackDefinition, remoteImageDefinition, type UIActionResult,
} from '@mcp-ui/client';
import type { EmbeddedResource } from '@modelcontextprotocol/sdk/types.js';

const root = createRoot(document.getElementById('root')!);
const pending = new Map<string, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
let sequence = 0;
const post = (data: unknown) => parent.postMessage(data, location.origin);

function onUIAction(action: UIActionResult): Promise<unknown> {
  // The RemoteDOM renderer forwards thread protocol messages as well as UI actions.
  if (!action || typeof action !== 'object' || Array.isArray(action) ||
      !['tool', 'prompt', 'intent', 'link', 'notify'].includes(action.type)) return Promise.resolve({});
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ type: 'basedcode-mcp-ui-action', id, action });
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type === 'basedcode-mcp-ui-response' && typeof data.id === 'string') {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) request?.reject(new Error(data.error));
    else request?.resolve(data.result);
  }
  if (data?.type !== 'basedcode-mcp-ui-render') return;
  const resource = { ...data.resource } as EmbeddedResource['resource'];
  // Both legacy variants use the basic element vocabulary; share the host's React components.
  if (resource.mimeType?.startsWith('application/vnd.mcp-ui.remote-dom'))
    resource.mimeType = resource.mimeType.replace(/framework=webcomponents/, 'framework=react');
  document.documentElement.style.colorScheme = data.renderData?.theme === 'light' ? 'light' : 'dark';
  root.render(createElement(UIResourceRenderer, {
    resource,
    onUIAction,
    remoteDomProps: {
      remoteElements: [remoteButtonDefinition, remoteTextDefinition, remoteStackDefinition, remoteImageDefinition],
    },
    htmlProps: {
      sandboxPermissions: 'allow-scripts allow-forms allow-pointer-lock allow-downloads',
      autoResizeIframe: { height: true },
      style: { width: '100%', height: '360px', border: '0' },
      iframeRenderData: data.renderData,
    },
  }));
});

new ResizeObserver(() => {
  post({ type: 'basedcode-mcp-ui-size', height: Math.ceil(document.body.getBoundingClientRect().height) });
}).observe(document.body);
post({ type: 'basedcode-mcp-ui-ready' });
