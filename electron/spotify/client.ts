import {
  AuthExpiredError,
  NetworkError,
  PremiumRequiredError,
  RateLimitError,
  SpotifyError,
  SpotifyServerError,
} from '../types.js';

const SPOTIFY_API = 'https://api.spotify.com/v1';

/**
 * Map a fetch Response (body already parsed-or-not) into one of our typed errors.
 * 200/204 → null. 401 → AuthExpiredError. 403 with PREMIUM_REQUIRED reason → PremiumRequiredError.
 * 403 other → generic SpotifyError. 429 → RateLimitError (parses Retry-After). 5xx → SpotifyServerError.
 *
 * Pure function — no fetch, no globals — so it's trivially testable.
 */
export function mapSpotifyError(
  status: number,
  body: unknown,
  headers?: { get(name: string): string | null },
): SpotifyError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return new AuthExpiredError(body);
  if (status === 403) {
    const reason = extractReason(body);
    if (reason === 'PREMIUM_REQUIRED') return new PremiumRequiredError(body);
    return new SpotifyError(extractMessage(body) ?? 'Spotify forbidden', {
      code: 'FORBIDDEN',
      status,
      body,
    });
  }
  if (status === 429) {
    const ra = headers?.get('Retry-After') ?? headers?.get('retry-after');
    const sec = ra && /^\d+$/.test(ra) ? parseInt(ra, 10) : 1;
    return new RateLimitError(sec, body);
  }
  if (status >= 500) return new SpotifyServerError(status, body);
  return new SpotifyError(extractMessage(body) ?? `Spotify error ${status}`, {
    code: 'SPOTIFY_ERROR',
    status,
    body,
  });
}

function extractReason(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (err && typeof err === 'object' && 'reason' in err) {
      const r = (err as { reason: unknown }).reason;
      if (typeof r === 'string') return r;
    }
  }
  return undefined;
}

function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && 'message' in err) {
      const m = (err as { message: unknown }).message;
      if (typeof m === 'string') return m;
    }
  }
  return undefined;
}

// ---------- Request wrapper ----------

export type AccessTokenProvider = () => Promise<string | null>;
export type RefreshFn = () => Promise<string>; // resolves to fresh access token

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /** When true, do not try to refresh on 401 (used inside refresh itself). */
  noRefresh?: boolean;
};

export type ClientDeps = {
  fetch: typeof fetch;
  getAccessToken: AccessTokenProvider;
  refresh: RefreshFn;
};

export function createSpotifyClient(deps: ClientDeps) {
  async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T | null> {
    const url = buildUrl(path, opts.query);
    const token = await deps.getAccessToken();
    const res = await doFetch(url, opts, token, deps.fetch);
    if (res.status === 204) return null;

    const contentType = res.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await safeJson(res) : null;
    const err = mapSpotifyError(res.status, body, res.headers);
    if (!err) return body as T;

    // 401 → refresh once and retry, unless we're already inside refresh.
    if (err instanceof AuthExpiredError && !opts.noRefresh) {
      const fresh = await deps.refresh();
      const retry = await doFetch(url, opts, fresh, deps.fetch);
      if (retry.status === 204) return null;
      const retryBody = (retry.headers.get('content-type') ?? '').includes('application/json')
        ? await safeJson(retry)
        : null;
      const retryErr = mapSpotifyError(retry.status, retryBody, retry.headers);
      if (retryErr) throw retryErr;
      return retryBody as T;
    }

    throw err;
  }

  return { request };
}

function buildUrl(p: string, query?: Record<string, string | number | undefined>): string {
  const base = p.startsWith('http') ? p : `${SPOTIFY_API}${p.startsWith('/') ? '' : '/'}${p}`;
  if (!query) return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function doFetch(
  url: string,
  opts: RequestOptions,
  token: string | null,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    throw new NetworkError(e);
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
