// Shared types between main, preload, and renderer.

export type Provider = 'spotify' | 'youtube' | 'demo';

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

export class ProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, opts: { code?: string; status?: number; body?: unknown } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = opts.code ?? 'PROVIDER_ERROR';
    this.status = opts.status ?? 0;
    this.body = opts.body ?? null;
  }
}

export class SpotifyError extends ProviderError {
  constructor(message: string, opts: { code?: string; status?: number; body?: unknown } = {}) {
    super(message, { ...opts, code: opts.code ?? 'SPOTIFY_ERROR' });
    this.name = 'SpotifyError';
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

// ---------- YouTube provider errors ----------

export class YouTubeError extends ProviderError {
  constructor(message: string, opts: { code?: string; status?: number; body?: unknown } = {}) {
    super(message, { ...opts, code: opts.code ?? 'YT_ERROR' });
    this.name = 'YouTubeError';
  }
}

export class YouTubeVideoUnavailableError extends YouTubeError {
  constructor(body?: unknown) {
    super('YouTube video is unavailable', { code: 'YT_VIDEO_UNAVAILABLE', body });
    this.name = 'YouTubeVideoUnavailableError';
  }
}

export class YouTubeEmbedDisabledError extends YouTubeError {
  constructor(body?: unknown) {
    super('Embedding has been disabled by the uploader', {
      code: 'YT_EMBED_DISABLED',
      body,
    });
    this.name = 'YouTubeEmbedDisabledError';
  }
}

export class YouTubePlayerNotReadyError extends YouTubeError {
  constructor() {
    super('YouTube player is not ready', { code: 'YT_PLAYER_NOT_READY' });
    this.name = 'YouTubePlayerNotReadyError';
  }
}

export class YouTubeNetworkError extends YouTubeError {
  constructor(cause?: unknown) {
    super('Network error reaching YouTube', { code: 'YT_NETWORK_ERROR', body: cause });
    this.name = 'YouTubeNetworkError';
  }
}

export class YouTubeAuthExpiredError extends YouTubeError {
  constructor(body?: unknown) {
    super('YouTube access token expired', {
      code: 'YT_AUTH_EXPIRED',
      status: 401,
      body,
    });
    this.name = 'YouTubeAuthExpiredError';
  }
}

export class YouTubeForbiddenError extends YouTubeError {
  constructor(body?: unknown) {
    super('YouTube request forbidden', { code: 'YT_FORBIDDEN', status: 403, body });
    this.name = 'YouTubeForbiddenError';
  }
}

export class YouTubeRateLimitError extends YouTubeError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, body?: unknown) {
    super(`YouTube rate limited (retry after ${retryAfterSec}s)`, {
      code: 'YT_RATE_LIMITED',
      status: 429,
      body,
    });
    this.name = 'YouTubeRateLimitError';
    this.retryAfterSec = retryAfterSec;
  }
}

export class YouTubeServerError extends YouTubeError {
  constructor(status: number, body?: unknown) {
    super(`YouTube server error (${status})`, { code: 'YT_SERVER_ERROR', status, body });
    this.name = 'YouTubeServerError';
  }
}

// Serialized error shape (what we send across IPC).
export type SerializedError = { code: string; message: string; status: number };

export function serializeError(err: unknown): SerializedError {
  if (err instanceof ProviderError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'UNKNOWN', message, status: 0 };
}
