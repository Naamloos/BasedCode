import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import QRCode from 'qrcode';
import type { RemoteAccessStatus } from '../../shared/types.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/**
 * Remote access through a Cloudflare quick tunnel. A second local server on a random port serves the
 * same UI and API as the desktop backend, but accepts only its own code, which travels in the URL hash
 * so it never reaches Cloudflare's logs or a Referer header.
 */
export class RemoteAccess {
  private server?: Server;
  private tunnel?: ChildProcess;
  private code = '';
  private status: RemoteAccessStatus = { state: 'stopped' };

  constructor(
    private readonly handler: Handler,
    private readonly onChange: () => void,
  ) {}

  get current(): RemoteAccessStatus {
    return this.status;
  }

  /** The tunnel's public origin, which the backend trusts as a browser origin while it runs. */
  get origin(): string | undefined {
    return this.status.url ? new URL(this.status.url).origin : undefined;
  }

  /** True when `supplied` is the current remote code. */
  accepts(supplied: string): boolean {
    return (
      !!this.code &&
      supplied.length === this.code.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(this.code))
    );
  }

  async start(cloudflaredPath: string): Promise<RemoteAccessStatus> {
    if (this.status.state !== 'stopped' && this.status.state !== 'error') return this.status;
    this.code = randomBytes(24).toString('base64url');
    this.set({ state: 'starting' });
    try {
      const server = createServer((request, response) => {
        void this.handler(request, response);
      });
      this.server = server;
      const port = await new Promise<number>((resolvePort, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (!address || typeof address === 'string')
            reject(new Error('Cannot determine remote server address.'));
          else resolvePort(address.port);
        });
      });
      const publicOrigin = await this.launch(cloudflaredPath || 'cloudflared', port);
      const url = `${publicOrigin}/#${this.code}`;
      const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      this.set({
        state: 'running',
        url,
        port,
        qr: `data:image/svg+xml;base64,${Buffer.from(qr).toString('base64')}`,
      });
    } catch (error) {
      this.close();
      this.set({ state: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    return this.status;
  }

  stop(): RemoteAccessStatus {
    this.close();
    this.set({ state: 'stopped' });
    return this.status;
  }

  /** Starts cloudflared and resolves with the trycloudflare.com origin it prints once the tunnel is up. */
  private launch(executable: string, port: number): Promise<string> {
    return new Promise((resolveOrigin, reject) => {
      const tunnel = spawn(
        executable,
        ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      );
      this.tunnel = tunnel;
      let output = '';
      const timeout = setTimeout(
        () => reject(new Error('cloudflared did not report a tunnel URL within 30 seconds.')),
        30_000,
      );
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-8000);
        const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(output);
        if (match) {
          clearTimeout(timeout);
          resolveOrigin(match[0]);
        }
      };
      tunnel.stdout?.on('data', read);
      tunnel.stderr?.on('data', read);
      tunnel.once('error', (error) => {
        clearTimeout(timeout);
        reject(
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? new Error(`Cannot find cloudflared ("${executable}"). Install it or set its path.`)
            : error,
        );
      });
      tunnel.once('exit', (code) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `cloudflared exited (${code}). ${output.trim().split('\n').slice(-3).join(' ')}`,
          ),
        );
        // A tunnel that dies after starting takes remote access down with it.
        if (this.tunnel === tunnel && this.status.state === 'running') {
          this.close();
          this.set({ state: 'error', error: `cloudflared exited (${code}).` });
        }
      });
    });
  }

  private close(): void {
    const tunnel = this.tunnel;
    this.tunnel = undefined;
    tunnel?.kill();
    this.server?.close();
    this.server?.closeAllConnections();
    this.server = undefined;
    this.code = '';
  }

  private set(status: RemoteAccessStatus): void {
    this.status = status;
    this.onChange();
  }
}
