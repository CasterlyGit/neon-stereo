import { describe, it, expect, beforeEach } from 'vitest';
import { createOAuth } from '../auth/oauth.js';
import { __setKeytarForTests } from '../auth/keychain.js';
import { challengeFromVerifier } from '../auth/pkce.js';
import { AuthStateMismatchError } from '../types.js';

function makeFakeKeytar() {
  const store = new Map<string, string>();
  return {
    store,
    impl: {
      getPassword: async (s: string, a: string) => store.get(`${s}:${a}`) ?? null,
      setPassword: async (s: string, a: string, v: string) => {
        store.set(`${s}:${a}`, v);
      },
      deletePassword: async (s: string, a: string) => store.delete(`${s}:${a}`),
    },
  };
}

function pickEphemeralPort(): number {
  // Port 0 lets the loopback server pick one. We pass 0 to runLoopback through the deps.
  return 0;
}

beforeEach(() => {
  __setKeytarForTests(null);
});

describe('oauth.login full PKCE flow', () => {
  it('happy path — opens browser, captures code, exchanges, persists refresh token', async () => {
    const kt = makeFakeKeytar();
    __setKeytarForTests(kt.impl);

    let capturedAuthorizeUrl = '';
    const openExternal = async (url: string): Promise<void> => {
      capturedAuthorizeUrl = url;
      // Parse the URL to find the redirect_uri/port + state.
      const u = new URL(url);
      const redirectUri = u.searchParams.get('redirect_uri') ?? '';
      const stateParam = u.searchParams.get('state') ?? '';
      // Hit the loopback server with a fake code. Defer slightly to let listen() finish.
      setTimeout(() => {
        const cb = new URL(redirectUri);
        cb.searchParams.set('code', 'fake-code');
        cb.searchParams.set('state', stateParam);
        // node fetch can hit loopback fine.
        void fetch(cb.toString()).catch(() => {});
      }, 5);
    };

    let postedBody: URLSearchParams | null = null;
    const fetchFake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.startsWith('https://accounts.spotify.com/api/token')) {
        postedBody = new URLSearchParams((init?.body as string) ?? '');
        return new Response(
          JSON.stringify({
            access_token: 'AT-fresh',
            refresh_token: 'RT-fresh',
            expires_in: 3600,
            scope: 'user-read-playback-state user-modify-playback-state',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ) as Response;
      }
      // Fall through to real fetch for the loopback hit.
      return globalThis.fetch(input as RequestInfo, init);
    };

    const events: unknown[] = [];
    const oauth = createOAuth({
      fetch: fetchFake,
      openExternal,
      clientId: 'TEST_CID',
      port: pickEphemeralPort(),
    });
    oauth.on('auth-changed', (e) => events.push(e));

    await oauth.login();

    // Authorize URL contained S256 + code_challenge.
    const u = new URL(capturedAuthorizeUrl);
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const challenge = u.searchParams.get('code_challenge') ?? '';
    expect(challenge.length).toBeGreaterThan(0);
    expect(u.searchParams.get('client_id')).toBe('TEST_CID');

    // Body sent to /api/token includes a verifier matching the challenge.
    expect(postedBody).not.toBeNull();
    const body = postedBody as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('fake-code');
    const verifier = body.get('code_verifier') ?? '';
    expect(challengeFromVerifier(verifier)).toBe(challenge);

    // Refresh token persisted to (fake) keytar.
    expect(kt.store.get('neon-stereo:spotify-refresh')).toBe('RT-fresh');
    // auth-changed emitted with logged-in.
    expect(events).toContainEqual({ kind: 'logged-in' });
  });

  it('rejects with AuthStateMismatchError when state does not match', async () => {
    const kt = makeFakeKeytar();
    __setKeytarForTests(kt.impl);

    const openExternal = async (url: string): Promise<void> => {
      const u = new URL(url);
      const redirectUri = u.searchParams.get('redirect_uri') ?? '';
      setTimeout(() => {
        const cb = new URL(redirectUri);
        cb.searchParams.set('code', 'fake-code');
        cb.searchParams.set('state', 'WRONG-STATE');
        void fetch(cb.toString()).catch(() => {});
      }, 5);
    };

    let tokenCalled = false;
    const fetchFake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.startsWith('https://accounts.spotify.com/api/token')) {
        tokenCalled = true;
        return new Response('{}', { status: 200 }) as Response;
      }
      return globalThis.fetch(input as RequestInfo, init);
    };

    const oauth = createOAuth({
      fetch: fetchFake,
      openExternal,
      clientId: 'TEST_CID',
      port: 0,
    });

    await expect(oauth.login()).rejects.toBeInstanceOf(AuthStateMismatchError);
    expect(tokenCalled).toBe(false);
    expect(kt.store.size).toBe(0);
  });
});
