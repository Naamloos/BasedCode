import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Store } from '../storage/store.js';
import type { Permissions } from '../workspace/permissions.js';
import type { ToolContext } from './definitions.js';

export function createPublicFetch(permissions: Permissions, store: Store, context: ToolContext) {
  const { workspace, run, signal } = context;
  /**
   * GETs a public HTTP(S) URL after approval: private addresses, credentials and redirects are refused, and the
   * response must pass `accepts` and stay under `limit` bytes.
   */
  return async (
    url: string,
    purpose: string,
    accept: string,
    limit: number,
    accepts: (contentType: string) => boolean,
  ) => {
    const initial = new URL(url);
    if (!['http:', 'https:'].includes(initial.protocol) || initial.username || initial.password)
      throw new Error('Fetch requires an HTTP(S) URL without embedded credentials.');
    const host = initial.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true, verbatim: true });
    const publicAddress = (address: string, family: number) => {
      if (family === 4) {
        const octets = address.split('.').map(Number);
        return (
          octets[0] !== 0 &&
          octets[0] !== 10 &&
          octets[0] !== 127 &&
          !(octets[0] === 169 && octets[1] === 254) &&
          !(octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) &&
          !(octets[0] === 192 && octets[1] === 168) &&
          octets[0] < 224
        );
      }
      const value = address.toLowerCase();
      return value === '::1' || value === '::'
        ? false
        : !(
            value.startsWith('fc') ||
            value.startsWith('fd') ||
            value.startsWith('fe8') ||
            value.startsWith('fe9') ||
            value.startsWith('fea') ||
            value.startsWith('feb')
          );
    };
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address, item.family)))
      throw new Error('Fetch is limited to public network addresses.');
    await permissions.ask(
      workspace.id,
      purpose,
      `GET ${initial.href}. The remote server receives your request; no credentials or custom headers are sent.`,
      signal,
      run,
    );
    const action = store.action(workspace.id, `Fetch: ${initial.hostname}`, initial.href, run);
    try {
      const pinned = new URL(initial);
      if (!isIP(host)) {
        const address = addresses[0];
        pinned.hostname = address.family === 6 ? `[${address.address}]` : address.address;
      }
      const response = await fetch(pinned, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        headers: { Host: initial.host, Accept: accept },
      });
      if (response.status >= 300 && response.status < 400)
        throw new Error(
          'Redirects are not followed. Fetch the redirect destination explicitly after reviewing it.',
        );
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      if (!accepts(contentType)) throw new Error(`Unsupported response type: ${contentType}`);
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > limit)
        throw new Error(`Response exceeds the ${Math.round(limit / 104_857.6) / 10} MiB limit.`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is empty.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error(`Response exceeds the ${Math.round(limit / 104_857.6) / 10} MiB limit.`);
        }
        chunks.push(value);
      }
      store.put('action', { ...action, status: 'completed' });
      return {
        url: initial.href,
        status: response.status,
        contentType,
        bytes: Buffer.concat(chunks),
      };
    } catch (error) {
      store.put('action', {
        ...action,
        status: 'failed',
        detail: `${action.detail}\\n${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  };
}
