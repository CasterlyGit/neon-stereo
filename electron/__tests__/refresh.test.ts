import { describe, it, expect, beforeEach } from 'vitest';
import { createOAuth } from '../auth/oauth.js';
import { __setKeytarForTests } from '../auth/keychain.js';
import { AuthExpiredError } from '../types.js';

function makeFakeKeytar(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
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
  __setKeytarForTests(null);
});

describe('oauth.refresh', () => {
  it('memoizes concurrent calls — fires fetch exactly once', async () => {
    const kt = makeFakeKeytar({ 'neon-stereo:spotify-refresh': 'rt-old' });
    __setKeytarForTests(kt.impl);

    let calls = 0;
    const fetchFake: typeof fetch = async () => {
      calls++;
      // Resolve after a microtask to ensure all 5 callers race.
      await new Promise((r) => setTimeout(r, 10));
      return new Response(
        JSON.stringify({ access_token: 'AT-1', expires_in: 3600, scope: 'a b' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as Response;
    };

    const oauth = createOAuth({
      fetch: fetchFake,
      openExternal: async () => {},
      clientId: 'CID',
    });

    const results = await Promise.all([
      oauth.refresh(),
      oauth.refresh(),
      oauth.refresh(),
      oauth.refresh(),
      oauth.refresh(),
    ]);
    expect(calls).toBe(1);
    for (const r of results) expect(r).toBe('AT-1');

    // After in-flight resolves, a fresh refresh() makes a NEW call.
    const second = await oauth.refresh();
    expect(calls).toBe(2);
    expect(second).toBe('AT-1');
  });

  it('clears keytar + emits logged-out on invalid_grant', async () => {
    const kt = makeFakeKeytar({ 'neon-stereo:spotify-refresh': 'rt-bad' });
    __setKeytarForTests(kt.impl);

    const fetchFake: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }) as Response;

    const events: unknown[] = [];
    const oauth = createOAuth({
      fetch: fetchFake,
      openExternal: async () => {},
      clientId: 'CID',
    });
    oauth.on('auth-changed', (e) => events.push(e));

    await expect(oauth.refresh()).rejects.toBeInstanceOf(AuthExpiredError);
    expect(kt.store.get('neon-stereo:spotify-refresh')).toBeUndefined();
    expect(events).toContainEqual({ kind: 'logged-out' });
  });
});
