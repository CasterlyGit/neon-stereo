import http from 'node:http';
import { URL } from 'node:url';
import { EventEmitter } from 'node:events';
import { challengeFromVerifier, generateState, generateVerifier } from './pkce.js';
import {
  clearRefreshToken,
  getRefreshToken,
  setRefreshToken,
} from './keychain.js';
import {
  AuthCancelledError,
  AuthExpiredError,
  AuthStateMismatchError,
  NetworkError,
  type AuthEvent,
} from '../types.js';

const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize';
const SCOPES = [
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
];
const REDIRECT_PORT = 53682; // rclone convention; fixed so it can be registered upstream

type AccessToken = { token: string; expiresAt: number; scopes: string[] };
type AuthState = { kind: 'logged-out' } | { kind: 'logged-in'; access: AccessToken };

export type Deps = {
  /** Open the system browser to a given URL. Injectable for tests. */
  openExternal: (url: string) => Promise<void> | void;
  /** Fetch implementation — injectable for tests. */
  fetch: typeof fetch;
  /** Spotify client ID — read from env at boot. */
  clientId: string;
  /** Optional override for redirect port (tests pass 0 for ephemeral). */
  port?: number;
};

export type OAuth = {
  login(): Promise<void>;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  refresh(): Promise<string>;
  getStatus(): AuthState;
  on(ev: 'auth-changed', cb: (e: AuthEvent) => void): void;
  off(ev: 'auth-changed', cb: (e: AuthEvent) => void): void;
};

export function createOAuth(deps: Deps): OAuth {
  const emitter = new EventEmitter();
  let state: AuthState = { kind: 'logged-out' };
  let inflightRefresh: Promise<string> | null = null;

  function emitAuth(event: AuthEvent): void {
    emitter.emit('auth-changed', event);
  }

  async function login(): Promise<void> {
    const verifier = generateVerifier();
    const challenge = challengeFromVerifier(verifier);
    const csrf = generateState();
    const port = deps.port ?? REDIRECT_PORT;

    const { code, redirectUri } = await runLoopback(port, csrf, async (url: string) => {
      await deps.openExternal(url);
    }, (loopbackPort) => {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: deps.clientId,
        redirect_uri: `http://127.0.0.1:${loopbackPort}/callback`,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        scope: SCOPES.join(' '),
        state: csrf,
      });
      return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
    });

    // Exchange code for tokens.
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: deps.clientId,
      code_verifier: verifier,
    });
    const res = await safeFetch(deps.fetch, TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json['access_token'] !== 'string' || typeof json['refresh_token'] !== 'string') {
      throw new AuthExpiredError(json);
    }
    const expiresIn = typeof json['expires_in'] === 'number' ? (json['expires_in'] as number) : 3600;
    const scopes =
      typeof json['scope'] === 'string' ? (json['scope'] as string).split(' ').filter(Boolean) : SCOPES;
    state = {
      kind: 'logged-in',
      access: {
        token: json['access_token'] as string,
        expiresAt: Date.now() + expiresIn * 1000,
        scopes,
      },
    };
    await setRefreshToken(json['refresh_token'] as string);
    emitAuth({ kind: 'logged-in' });
  }

  async function logout(): Promise<void> {
    await clearRefreshToken();
    state = { kind: 'logged-out' };
    emitAuth({ kind: 'logged-out' });
  }

  async function refresh(): Promise<string> {
    if (inflightRefresh) return inflightRefresh;
    inflightRefresh = (async (): Promise<string> => {
      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) throw new AuthExpiredError();
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: deps.clientId,
        });
        const res = await safeFetch(deps.fetch, TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.status === 400 && json['error'] === 'invalid_grant') {
          await clearRefreshToken();
          state = { kind: 'logged-out' };
          emitAuth({ kind: 'logged-out' });
          throw new AuthExpiredError(json);
        }
        if (!res.ok || typeof json['access_token'] !== 'string') {
          throw new AuthExpiredError(json);
        }
        const expiresIn =
          typeof json['expires_in'] === 'number' ? (json['expires_in'] as number) : 3600;
        const access: AccessToken = {
          token: json['access_token'] as string,
          expiresAt: Date.now() + expiresIn * 1000,
          scopes: state.kind === 'logged-in' ? state.access.scopes : SCOPES,
        };
        // Spotify may rotate the refresh token.
        if (typeof json['refresh_token'] === 'string') {
          await setRefreshToken(json['refresh_token'] as string);
        }
        state = { kind: 'logged-in', access };
        return access.token;
      } finally {
        inflightRefresh = null;
      }
    })();
    return inflightRefresh;
  }

  async function getAccessToken(): Promise<string | null> {
    if (state.kind === 'logged-in' && Date.now() < state.access.expiresAt - 60_000) {
      return state.access.token;
    }
    // Try refresh if we have a stored refresh token.
    const stored = await getRefreshToken();
    if (!stored) return null;
    try {
      return await refresh();
    } catch {
      return null;
    }
  }

  return {
    login,
    logout,
    refresh,
    getAccessToken,
    getStatus: () => state,
    on: (ev, cb) => {
      emitter.on(ev, cb);
    },
    off: (ev, cb) => {
      emitter.off(ev, cb);
    },
  };
}

async function safeFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    throw new NetworkError(e);
  }
}

// ---------- Loopback HTTP server ----------

/**
 * Boot a one-shot HTTP server, open the authorize URL, await the callback.
 * Resolves with the auth code once it arrives. Verifies state. Times out at 5 min.
 */
export function runLoopback(
  port: number,
  expectedState: string,
  openUrl: (url: string) => Promise<void>,
  buildAuthorizeUrl: (port: number) => string,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    const cleanup = (): void => {
      if (!settled) settled = true;
      server.close();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new AuthCancelledError());
    }, 5 * 60_000);

    server.on('request', (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        if (url.pathname !== '/callback') {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        const code = url.searchParams.get('code');
        const stateParam = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        if (error) {
          res.statusCode = 400;
          res.end('Spotify auth error: ' + error);
          clearTimeout(timer);
          cleanup();
          reject(new AuthCancelledError());
          return;
        }
        if (!code || stateParam !== expectedState) {
          res.statusCode = 400;
          res.end('state mismatch');
          clearTimeout(timer);
          cleanup();
          reject(new AuthStateMismatchError());
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(SUCCESS_HTML);
        const actualPort = (server.address() as { port: number } | null)?.port ?? port;
        clearTimeout(timer);
        cleanup();
        resolve({ code, redirectUri: `http://127.0.0.1:${actualPort}/callback` });
      } catch (e) {
        clearTimeout(timer);
        cleanup();
        reject(e);
      }
    });

    server.on('error', (e) => {
      clearTimeout(timer);
      cleanup();
      reject(e);
    });

    server.listen(port, '127.0.0.1', () => {
      const actualPort = (server.address() as { port: number } | null)?.port ?? port;
      const url = buildAuthorizeUrl(actualPort);
      openUrl(url).catch((e) => {
        clearTimeout(timer);
        cleanup();
        reject(e);
      });
    });
  });
}

const SUCCESS_HTML = `<!doctype html>
<html><head><title>neon-stereo</title>
<style>
body{background:#0a0a12;color:#e6e8ef;font-family:ui-monospace,Menlo,monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center}
h1{color:#ff3ec8;text-shadow:0 0 4px #ff3ec8,0 0 12px #ff3ec8,0 0 28px #ff3ec8}
p{color:#7d8094}
</style></head>
<body><div class="card"><h1>neon-stereo connected</h1><p>You can close this tab and return to the app.</p></div></body></html>`;
