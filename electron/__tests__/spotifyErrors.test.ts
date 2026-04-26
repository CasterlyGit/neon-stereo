import { describe, it, expect } from 'vitest';
import { mapSpotifyError } from '../spotify/client.js';
import {
  AuthExpiredError,
  PremiumRequiredError,
  RateLimitError,
  SpotifyError,
  SpotifyServerError,
} from '../types.js';

function headers(map: Record<string, string>): { get(name: string): string | null } {
  return {
    get(name: string) {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) return v;
      }
      return null;
    },
  };
}

describe('mapSpotifyError', () => {
  it('200 → null', () => {
    expect(mapSpotifyError(200, { ok: true })).toBeNull();
  });

  it('204 → null', () => {
    expect(mapSpotifyError(204, null)).toBeNull();
  });

  it('401 → AuthExpiredError', () => {
    const err = mapSpotifyError(401, { error: 'expired' });
    expect(err).toBeInstanceOf(AuthExpiredError);
    expect(err?.code).toBe('AUTH_EXPIRED');
  });

  it('403 PREMIUM_REQUIRED → PremiumRequiredError', () => {
    const err = mapSpotifyError(403, {
      error: { status: 403, reason: 'PREMIUM_REQUIRED', message: 'Premium required' },
    });
    expect(err).toBeInstanceOf(PremiumRequiredError);
    expect(err?.code).toBe('PREMIUM_REQUIRED');
    expect(err?.message).toBe('Spotify Premium is required to control playback');
  });

  it('403 with another reason → generic SpotifyError, NOT premium', () => {
    const err = mapSpotifyError(403, {
      error: { status: 403, reason: 'NO_ACTIVE_DEVICE', message: 'no device' },
    });
    expect(err).toBeInstanceOf(SpotifyError);
    expect(err).not.toBeInstanceOf(PremiumRequiredError);
    expect(err?.code).toBe('FORBIDDEN');
  });

  it('429 with Retry-After: 7 → RateLimitError(retryAfterSec=7)', () => {
    const err = mapSpotifyError(429, null, headers({ 'Retry-After': '7' }));
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSec).toBe(7);
  });

  it('429 without Retry-After → RateLimitError default 1', () => {
    const err = mapSpotifyError(429, null, headers({}));
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSec).toBe(1);
  });

  it('500 → SpotifyServerError', () => {
    const err = mapSpotifyError(500, null);
    expect(err).toBeInstanceOf(SpotifyServerError);
    expect(err?.status).toBe(500);
  });

  it('502 → SpotifyServerError', () => {
    const err = mapSpotifyError(502, null);
    expect(err).toBeInstanceOf(SpotifyServerError);
  });
});
