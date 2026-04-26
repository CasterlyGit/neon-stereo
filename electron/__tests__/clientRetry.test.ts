import { describe, it, expect } from 'vitest';
import { createSpotifyClient } from '../spotify/client.js';

describe('client 401 → refresh → retry', () => {
  it('first call 401, refresh issues new token, retry succeeds', async () => {
    let getMePlayerCalls = 0;
    let refreshCalls = 0;
    let currentToken = 'OLD';

    const fetchFake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
      if (url.includes('/v1/me/player')) {
        getMePlayerCalls++;
        if (auth === 'Bearer OLD') {
          return new Response(JSON.stringify({ error: { status: 401, message: 'expired' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }) as Response;
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }) as Response;
      }
      throw new Error('unexpected url ' + url);
    };

    const client = createSpotifyClient({
      fetch: fetchFake,
      getAccessToken: async () => currentToken,
      refresh: async () => {
        refreshCalls++;
        currentToken = 'NEW';
        return 'NEW';
      },
    });

    const out = await client.request<{ ok: true }>('/me/player');
    expect(out).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
    expect(getMePlayerCalls).toBe(2);
  });
});
