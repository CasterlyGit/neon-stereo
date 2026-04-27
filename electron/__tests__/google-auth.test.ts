import { describe, it, expect, beforeEach } from 'vitest';
import {
  __setGoogleKeytarForTests,
  createGoogleOAuth,
  GOOGLE_AUTHORIZE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  YOUTUBE_SCOPES,
} from '../auth/google.js';
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

beforeEach(() => {
  __setGoogleKeytarForTests(null);
});

describe('googleOAuth.login full PKCE flow', () => {
  it('happy path — opens Google, captures code, exchanges, persists refresh token under google account', async () => {
    const kt = makeFakeKeytar();
    __setGoogleKeytarForTests(kt.impl);

    let capturedAuthorizeUrl = '';
    const openExternal = async (url: string): Promise<void> => {
      capturedAuthorizeUrl = url;
      const u = new URL(url);
      const redirectUri = u.searchParams.get('redirect_uri') ?? '';
      const stateParam = u.searchParams.get('state') ?? '';
      setTimeout(() => {
        const cb = new URL(redirectUri);
        cb.searchParams.set('code', 'fake-code');
        cb.searchParams.set('state', stateParam);
        void fetch(cb.toString()).catch(() => {});
      }, 5);
    };

    let postedBody: URLSearchParams | null = null;
    const fetchFake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.startsWith(GOOGLE_TOKEN_ENDPOINT)) {
        postedBody = new URLSearchParams((init?.body as string) ?? '');
        return new Response(
          JSON.stringify({
            access_token: 'AT-google-fresh',
            refresh_token: 'RT-google-fresh',
            expires_in: 3600,
            scope: YOUTUBE_SCOPES.join(' '),
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ) as Response;
      }
      return globalThis.fetch(input as Parameters<typeof fetch>[0], init);
    };

    const events: unknown[] = [];
    const oauth = createGoogleOAuth({
      fetch: fetchFake,
      openExternal,
      clientId: 'GOOGLE_TEST_CID',
      port: 0,
    });
    oauth.on('auth-changed', (e) => events.push(e));

    await oauth.login();

    // Authorize URL points to Google with PKCE + offline access + YouTube scope.
    const u = new URL(capturedAuthorizeUrl);
    expect(u.origin + u.pathname).toBe(GOOGLE_AUTHORIZE_ENDPOINT);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('client_id')).toBe('GOOGLE_TEST_CID');
    expect(u.searchParams.get('scope')).toBe(YOUTUBE_SCOPES.join(' '));
    const challenge = u.searchParams.get('code_challenge') ?? '';
    expect(challenge.length).toBeGreaterThan(0);

    // Token-endpoint body carries verifier matching the challenge.
    expect(postedBody).not.toBeNull();
    const body = postedBody as unknown as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('fake-code');
    const verifier = body.get('code_verifier') ?? '';
    expect(challengeFromVerifier(verifier)).toBe(challenge);

    // Refresh token stored in the google-refresh keytar slot — separate from spotify-refresh.
    expect(kt.store.get('neon-stereo:google-refresh')).toBe('RT-google-fresh');
    expect(kt.store.get('neon-stereo:spotify-refresh')).toBeUndefined();

    // auth-changed emitted with logged-in.
    expect(events).toContainEqual({ kind: 'logged-in' });

    // Status reflects the logged-in state.
    expect(oauth.getStatus().kind).toBe('logged-in');
  });

  it('rejects with AuthStateMismatchError when state does not match', async () => {
    const kt = makeFakeKeytar();
    __setGoogleKeytarForTests(kt.impl);

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
      if (url.startsWith(GOOGLE_TOKEN_ENDPOINT)) {
        tokenCalled = true;
        return new Response('{}', { status: 200 }) as Response;
      }
      return globalThis.fetch(input as Parameters<typeof fetch>[0], init);
    };

    const oauth = createGoogleOAuth({
      fetch: fetchFake,
      openExternal,
      clientId: 'GOOGLE_TEST_CID',
      port: 0,
    });

    await expect(oauth.login()).rejects.toBeInstanceOf(AuthStateMismatchError);
    expect(tokenCalled).toBe(false);
    expect(kt.store.size).toBe(0);
  });

  it('refresh uses the stored google refresh token and updates state', async () => {
    const kt = makeFakeKeytar();
    kt.store.set('neon-stereo:google-refresh', 'RT-google-stored');
    __setGoogleKeytarForTests(kt.impl);

    let refreshCalls = 0;
    const fetchFake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.startsWith(GOOGLE_TOKEN_ENDPOINT)) {
        refreshCalls++;
        const body = new URLSearchParams((init?.body as string) ?? '');
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('RT-google-stored');
        return new Response(
          JSON.stringify({
            access_token: 'AT-google-refreshed',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ) as Response;
      }
      throw new Error('unexpected fetch: ' + url);
    };

    const oauth = createGoogleOAuth({
      fetch: fetchFake,
      openExternal: async () => {},
      clientId: 'GOOGLE_TEST_CID',
      port: 0,
    });

    const token = await oauth.refresh();
    expect(token).toBe('AT-google-refreshed');
    expect(refreshCalls).toBe(1);
    expect(oauth.getStatus().kind).toBe('logged-in');
  });
});
