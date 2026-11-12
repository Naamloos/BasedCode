import { randomBytes } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ServerConfig } from '../../shared/types.js';
import type { Credentials } from '../providers/credentials.js';

/** Credential-store names for one MCP server. Everything for a server shares the `mcp:<id>:` prefix. */
export const mcpSecretPrefix = (serverId: string) => `mcp:${serverId}:`;
export const mcpSecretKey = (serverId: string, name: string) =>
  `${mcpSecretPrefix(serverId)}${name}`;
const oauthKey = (serverId: string) => mcpSecretKey(serverId, 'oauth');
export const oauthCallbackPath = '/oauth/mcp/callback';

interface SavedOAuth {
  tokens?: OAuthTokens;
  client?: OAuthClientInformationMixed;
  /** Dynamic registrations are tied to the redirect URL, which changes with the backend port. */
  redirectUrl?: string;
}

/**
 * OAuth state for one MCP server, persisted in the OS credential store. In connection mode (`interactive` false)
 * a missing or expired sign-in fails instead of opening a browser in the middle of an agent run.
 */
class StoredOAuthProvider implements OAuthClientProvider {
  private verifier = '';
  readonly stateValue = randomBytes(24).toString('base64url');

  constructor(
    private readonly server: ServerConfig,
    private readonly credentials: Credentials,
    private readonly origin: () => string,
    private readonly interactive: boolean,
    private readonly open: (url: string) => void,
  ) {}

  get redirectUrl(): string {
    return `${this.origin()}${oauthCallbackPath}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'BasedCode',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.server.oauth?.scopes ? { scope: this.server.oauth.scopes } : {}),
    };
  }

  state(): string {
    return this.stateValue;
  }

  private async read(): Promise<SavedOAuth> {
    const raw = await this.credentials.get(oauthKey(this.server.id));
    try {
      return raw ? (JSON.parse(raw) as SavedOAuth) : {};
    } catch {
      return {};
    }
  }

  private async write(update: Partial<SavedOAuth>): Promise<void> {
    await this.credentials.set(
      oauthKey(this.server.id),
      JSON.stringify({ ...(await this.read()), ...update }),
    );
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const clientId = this.server.oauth?.clientId;
    if (clientId) {
      const secret = await this.credentials.get(mcpSecretKey(this.server.id, 'oauthClientSecret'));
      return {
        client_id: clientId,
        ...(secret ? { client_secret: secret } : {}),
      };
    }
    const saved = await this.read();
    return saved.redirectUrl === this.redirectUrl ? saved.client : undefined;
  }

  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.write({ client, redirectUrl: this.redirectUrl });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.read()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.write({ tokens });
  }

  redirectToAuthorization(url: URL): void {
    if (!this.interactive)
      throw new Error(
        `${this.server.name} needs you to sign in again. Open App settings › MCP and choose Sign in.`,
      );
    if (!['https:', 'http:'].includes(url.protocol))
      throw new Error('Authorization URL must be HTTP(S).');
    this.open(url.href);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new Error('No sign-in is in progress.');
    return this.verifier;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    if (scope === 'verifier' || scope === 'discovery') return;
    const saved = await this.read();
    if (scope === 'all') await this.credentials.remove(oauthKey(this.server.id));
    else if (scope === 'tokens') await this.write({ ...saved, tokens: undefined });
    else await this.write({ ...saved, client: undefined });
  }
}

/** Runs browser sign-ins for OAuth MCP servers and hands connections a non-interactive provider. */
export class McpOAuth {
  private readonly pending = new Map<
    string,
    {
      server: ServerConfig;
      provider: StoredOAuthProvider;
      expires: number;
      done: (error?: Error) => void;
    }
  >();

  constructor(
    private readonly credentials: Credentials,
    private readonly origin: () => string,
    private readonly open: (url: string) => void,
  ) {}

  provider(server: ServerConfig): OAuthClientProvider {
    return new StoredOAuthProvider(server, this.credentials, this.origin, false, this.open);
  }

  async signedIn(serverId: string): Promise<boolean> {
    if (!this.credentials.list().includes(oauthKey(serverId))) return false;
    const raw = await this.credentials.get(oauthKey(serverId)).catch(() => undefined);
    return Boolean(raw && (JSON.parse(raw) as SavedOAuth).tokens?.access_token);
  }

  async signOut(serverId: string): Promise<void> {
    await this.credentials.remove(oauthKey(serverId));
  }

  /** Opens the authorization page; resolves once the browser comes back to the callback (or fails/times out). */
  async signIn(server: ServerConfig): Promise<void> {
    if (!server.url || server.transport === 'stdio')
      throw new Error('Only remote servers use OAuth.');
    for (const [state, entry] of this.pending)
      if (entry.expires < Date.now()) this.pending.delete(state);
    const provider = new StoredOAuthProvider(
      server,
      this.credentials,
      this.origin,
      true,
      this.open,
    );
    const finished = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(provider.stateValue);
        reject(new Error('Sign-in timed out.'));
      }, 10 * 60_000);
      this.pending.set(provider.stateValue, {
        server,
        provider,
        expires: Date.now() + 10 * 60_000,
        done: (error) => {
          clearTimeout(timer);
          this.pending.delete(provider.stateValue);
          if (error) reject(error);
          else resolve();
        },
      });
    });
    let result;
    try {
      result = await auth(provider, {
        serverUrl: server.url,
        scope: server.oauth?.scopes || undefined,
      });
    } catch (error) {
      this.pending.get(provider.stateValue)?.done(error as Error);
      await finished.catch(() => undefined);
      throw error;
    }
    if (result === 'AUTHORIZED') {
      this.pending.get(provider.stateValue)?.done();
      return;
    }
    await finished;
  }

  /** Handles the browser redirect. Returns the page text to show. */
  async callback(params: URLSearchParams): Promise<{ ok: boolean; message: string }> {
    const entry = this.pending.get(params.get('state') ?? '');
    if (!entry)
      return {
        ok: false,
        message: 'This sign-in link expired or was already used.',
      };
    const failure = params.get('error');
    const code = params.get('code');
    if (failure || !code) {
      const message = `Sign-in failed: ${(params.get('error_description') ?? failure ?? 'no code').slice(0, 300)}`;
      entry.done(new Error(message));
      return { ok: false, message };
    }
    try {
      await auth(entry.provider, {
        serverUrl: entry.server.url!,
        authorizationCode: code,
        scope: entry.server.oauth?.scopes || undefined,
      });
      entry.done();
      return {
        ok: true,
        message: `Signed in to ${entry.server.name}. You can close this tab.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entry.done(new Error(message));
      return { ok: false, message: `Sign-in failed: ${message.slice(0, 300)}` };
    }
  }
}
