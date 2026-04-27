// Google OAuth 2.0 (PKCE, installed-app flow) for the YouTube sign-in entry point.
// Mirrors the Spotify scaffold in oauth.ts: loopback redirect, S256 PKCE, and a refresh
// token persisted via keytar with a JSON-file fallback. Kept self-contained so the
// Spotify-only keychain wrapper does not need to grow a second account type.
//
// Reference: https://developers.google.com/identity/protocols/oauth2/native-app

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { challengeFromVerifier, generateState, generateVerifier } from './pkce.js';
import { runLoopback } from './oauth.js';
import {
  AuthExpiredError,
  NetworkError,
  type AuthEvent,
} from '../types.js';

export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
// Minimal scope sufficient to confirm the user signed in to a YouTube account.
// No playback / API calls are made yet (per AC).
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
const REDIRECT_PORT = 53682; // shared loopback port — only one OAuth flow runs at a time

const KEYTAR_SERVICE = 'neon-stereo';
const KEYTAR_ACCOUNT = 'google-refresh';
const FILE_KEY = 'google_refresh_token';

type AccessToken = { token: string; expiresAt: number; scopes: string[] };
type AuthState = { kind: 'logged-out' } | { kind: 'logged-in'; access: AccessToken };

export type GoogleDeps = {
  openExternal: (url: string) => Promise<void> | void;
  fetch: typeof fetch;
  /** Google OAuth client ID (Desktop / Installed-app credential). */
  clientId: string;
  /** Optional override for redirect port (tests pass 0 for ephemeral). */
  port?: number;
};

export type GoogleOAuth = {
  login(): Promise<void>;
  logout(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  refresh(): Promise<string>;
  getStatus(): AuthState;
  on(ev: 'auth-changed', cb: (e: AuthEvent) => void): void;
  off(ev: 'auth-changed', cb: (e: AuthEvent) => void): void;
};

// ---------- Token store (keytar with JSON-file fallback) ----------

type Keytar = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytar: Keytar | null = null;
let keytarTried = false;

async function loadKeytar(): Promise<Keytar | null> {
  if (keytarTried) return keytar;
  keytarTried = true;
  try {
    const mod = (await import('keytar')) as unknown as { default?: Keytar } & Keytar;
    keytar = (mod.default ?? mod) as Keytar;
    return keytar;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[neon-stereo] keytar unavailable for google, falling back to JSON file:', e);
    keytar = null;
    return null;
  }
}

function fallbackPath(): string {
  const dir =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'neon-stereo')
      : path.join(os.homedir(), '.config', 'neon-stereo');
  return path.join(dir, 'tokens.json');
}

async function fileGet(): Promise<string | null> {
  try {
    const raw = await fs.readFile(fallbackPath(), 'utf8');
    const obj = JSON.parse(raw) as Record<string, string>;
    return typeof obj[FILE_KEY] === 'string' ? (obj[FILE_KEY] ?? null) : null;
  } catch {
    return null;
  }
}

async function fileSet(token: string): Promise<void> {
  const p = fallbackPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  let existing: Record<string, string> = {};
  try {
    existing = JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, string>;
  } catch {
    /* fresh file */
  }
  existing[FILE_KEY] = token;
  await fs.writeFile(p, JSON.stringify(existing), { mode: 0o600 });
}

async function fileClear(): Promise<void> {
  try {
    const p = fallbackPath();
    const obj = JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, string>;
    delete obj[FILE_KEY];
    if (Object.keys(obj).length === 0) await fs.unlink(p);
    else await fs.writeFile(p, JSON.stringify(obj), { mode: 0o600 });
  } catch {
    /* noop */
  }
}

export async function getGoogleRefreshToken(): Promise<string | null> {
  const k = await loadKeytar();
  if (k) {
    try {
      return await k.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    } catch {
      return fileGet();
    }
  }
  return fileGet();
}

export async function setGoogleRefreshToken(token: string): Promise<void> {
  const k = await loadKeytar();
  if (k) {
    try {
      await k.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, token);
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[neon-stereo] keytar.setPassword failed for google, using JSON fallback', e);
    }
  }
  await fileSet(token);
}

export async function clearGoogleRefreshToken(): Promise<void> {
  const k = await loadKeytar();
  if (k) {
    try {
      await k.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    } catch {
      /* fall through */
    }
  }
  await fileClear();
}

// Test-only injection seam.
export function __setGoogleKeytarForTests(fake: Keytar | null): void {
  keytar = fake;
  keytarTried = true;
}

// ---------- OAuth factory ----------

export function createGoogleOAuth(deps: GoogleDeps): GoogleOAuth {
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

    const { code, redirectUri } = await runLoopback(
      port,
      csrf,
      async (url: string) => {
        await deps.openExternal(url);
      },
      (loopbackPort) => {
        const params = new URLSearchParams({
          response_type: 'code',
          client_id: deps.clientId,
          redirect_uri: `http://127.0.0.1:${loopbackPort}/callback`,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          scope: YOUTUBE_SCOPES.join(' '),
          state: csrf,
          // Required for Google to issue a refresh token on installed-app flows.
          access_type: 'offline',
          // Force the consent screen so a refresh_token is returned every sign-in.
          prompt: 'consent',
          include_granted_scopes: 'true',
        });
        return `${GOOGLE_AUTHORIZE_ENDPOINT}?${params.toString()}`;
      },
    );

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: deps.clientId,
      code_verifier: verifier,
    });
    const res = await safeFetch(deps.fetch, GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (
      !res.ok ||
      typeof json['access_token'] !== 'string' ||
      typeof json['refresh_token'] !== 'string'
    ) {
      throw new AuthExpiredError(json);
    }
    const expiresIn = typeof json['expires_in'] === 'number' ? (json['expires_in'] as number) : 3600;
    const scopes =
      typeof json['scope'] === 'string'
        ? (json['scope'] as string).split(' ').filter(Boolean)
        : YOUTUBE_SCOPES;
    state = {
      kind: 'logged-in',
      access: {
        token: json['access_token'] as string,
        expiresAt: Date.now() + expiresIn * 1000,
        scopes,
      },
    };
    await setGoogleRefreshToken(json['refresh_token'] as string);
    emitAuth({ kind: 'logged-in' });
  }

  async function logout(): Promise<void> {
    await clearGoogleRefreshToken();
    state = { kind: 'logged-out' };
    emitAuth({ kind: 'logged-out' });
  }

  async function refresh(): Promise<string> {
    if (inflightRefresh) return inflightRefresh;
    inflightRefresh = (async (): Promise<string> => {
      try {
        const refreshToken = await getGoogleRefreshToken();
        if (!refreshToken) throw new AuthExpiredError();
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: deps.clientId,
        });
        const res = await safeFetch(deps.fetch, GOOGLE_TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (
          (res.status === 400 || res.status === 401) &&
          (json['error'] === 'invalid_grant' || json['error'] === 'invalid_token')
        ) {
          await clearGoogleRefreshToken();
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
          scopes: state.kind === 'logged-in' ? state.access.scopes : YOUTUBE_SCOPES,
        };
        // Google does not normally rotate the refresh token, but accept it if returned.
        if (typeof json['refresh_token'] === 'string') {
          await setGoogleRefreshToken(json['refresh_token'] as string);
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
    const stored = await getGoogleRefreshToken();
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
