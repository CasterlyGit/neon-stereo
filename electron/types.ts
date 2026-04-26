// Shared types between main, preload, and renderer.

export type Track = {
  id: string;
  title: string;
  artists: string[];
  album: { name: string; artUrl: string | null };
  durationMs: number;
};

export type Device = {
  id: string;
  name: string;
  type: string;
  volumePercent: number;
};

export type PlaybackState =
  | { kind: 'no-device' }
  | { kind: 'idle'; device: Device }
  | {
      kind: 'playing' | 'paused';
      device: Device;
      track: Track;
      positionMs: number;
      isPlaying: boolean;
      asOf: number;
      shuffle: boolean;
      repeat: 'off' | 'track' | 'context';
    };

export type AuthEvent = { kind: 'logged-in' } | { kind: 'logged-out' };

// ---------- Error classes ----------

export class SpotifyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, opts: { code?: string; status?: number; body?: unknown } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.code = opts.code ?? 'SPOTIFY_ERROR';
    this.status = opts.status ?? 0;
    this.body = opts.body ?? null;
  }
}

export class AuthExpiredError extends SpotifyError {
  constructor(body?: unknown) {
    super('Spotify access token expired', { code: 'AUTH_EXPIRED', status: 401, body });
    this.name = 'AuthExpiredError';
  }
}

export class PremiumRequiredError extends SpotifyError {
  constructor(body?: unknown) {
    super('Spotify Premium is required to control playback', {
      code: 'PREMIUM_REQUIRED',
      status: 403,
      body,
    });
    this.name = 'PremiumRequiredError';
  }
}

export class RateLimitError extends SpotifyError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, body?: unknown) {
    super(`Rate limited (retry after ${retryAfterSec}s)`, {
      code: 'RATE_LIMITED',
      status: 429,
      body,
    });
    this.name = 'RateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

export class SpotifyServerError extends SpotifyError {
  constructor(status: number, body?: unknown) {
    super(`Spotify server error (${status})`, { code: 'SERVER_ERROR', status, body });
    this.name = 'SpotifyServerError';
  }
}

export class NetworkError extends SpotifyError {
  constructor(cause?: unknown) {
    super('Network error reaching Spotify', { code: 'NETWORK_ERROR', status: 0, body: cause });
    this.name = 'NetworkError';
  }
}

export class AuthCancelledError extends SpotifyError {
  constructor() {
    super('Authentication cancelled by user', { code: 'AUTH_CANCELLED' });
    this.name = 'AuthCancelledError';
  }
}

export class AuthStateMismatchError extends SpotifyError {
  constructor() {
    super('OAuth state mismatch', { code: 'AUTH_STATE_MISMATCH' });
    this.name = 'AuthStateMismatchError';
  }
}

// Serialized error shape (what we send across IPC).
export type SerializedError = { code: string; message: string; status: number };

export function serializeError(err: unknown): SerializedError {
  if (err instanceof SpotifyError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'UNKNOWN', message, status: 0 };
}
