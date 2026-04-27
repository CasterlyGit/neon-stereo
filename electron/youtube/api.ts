// YouTube Data API v3 client. Mirrors the shape of spotify/client.ts: typed error
// mapping, a single request() that handles 401 → refresh → retry once, plus
// thin convenience methods covering the surface the issue calls out (library,
// playlists, search). Uses the Google OAuth tokens minted by auth/google.ts.
//
// Reference: https://developers.google.com/youtube/v3/docs

import {
  YouTubeAuthExpiredError,
  YouTubeError,
  YouTubeForbiddenError,
  YouTubeNetworkError,
  YouTubeRateLimitError,
  YouTubeServerError,
} from '../types.js';

export const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

export function mapYouTubeApiError(
  status: number,
  body: unknown,
  headers?: { get(name: string): string | null },
): YouTubeError | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return new YouTubeAuthExpiredError(body);
  if (status === 403) return new YouTubeForbiddenError(body);
  if (status === 429) {
    const ra = headers?.get('Retry-After') ?? headers?.get('retry-after');
    const sec = ra && /^\d+$/.test(ra) ? parseInt(ra, 10) : 1;
    return new YouTubeRateLimitError(sec, body);
  }
  if (status >= 500) return new YouTubeServerError(status, body);
  return new YouTubeError(extractMessage(body) ?? `YouTube error ${status}`, {
    code: 'YT_ERROR',
    status,
    body,
  });
}

function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (err && typeof err === 'object' && 'message' in err) {
      const m = (err as { message: unknown }).message;
      if (typeof m === 'string') return m;
    }
  }
  return undefined;
}

export type YouTubeRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  noRefresh?: boolean;
};

export type YouTubeClientDeps = {
  fetch: typeof fetch;
  getAccessToken: () => Promise<string | null>;
  refresh: () => Promise<string>;
};

// ---------- Mapped shapes (just enough to be useful at the IPC boundary) ----------

export type YouTubePlaylistSummary = {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl: string | null;
};

export type YouTubeVideoSummary = {
  id: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  durationMs: number | null;
};

export type YouTubeSearchResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
};

export type YouTubePlaylistItem = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
};

export type YouTubeApiClient = {
  request<T = unknown>(path: string, opts?: YouTubeRequestOptions): Promise<T | null>;
  /** "Library" surface: the signed-in user's liked videos. */
  listLikedVideos(opts?: { maxResults?: number }): Promise<YouTubeVideoSummary[]>;
  /** Signed-in user's playlists. */
  listMyPlaylists(opts?: { maxResults?: number }): Promise<YouTubePlaylistSummary[]>;
  /** Videos inside a playlist. */
  listPlaylistItems(
    playlistId: string,
    opts?: { maxResults?: number },
  ): Promise<YouTubePlaylistItem[]>;
  /** Search YouTube for videos matching the query. */
  search(q: string, opts?: { maxResults?: number }): Promise<YouTubeSearchResult[]>;
};

export function createYouTubeApiClient(deps: YouTubeClientDeps): YouTubeApiClient {
  async function request<T = unknown>(
    path: string,
    opts: YouTubeRequestOptions = {},
  ): Promise<T | null> {
    const url = buildUrl(path, opts.query);
    const token = await deps.getAccessToken();
    const res = await doFetch(url, opts, token, deps.fetch);
    if (res.status === 204) return null;

    const contentType = res.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json') ? await safeJson(res) : null;
    const err = mapYouTubeApiError(res.status, body, res.headers);
    if (!err) return body as T;

    if (err instanceof YouTubeAuthExpiredError && !opts.noRefresh) {
      const fresh = await deps.refresh();
      const retry = await doFetch(url, opts, fresh, deps.fetch);
      if (retry.status === 204) return null;
      const retryBody = (retry.headers.get('content-type') ?? '').includes('application/json')
        ? await safeJson(retry)
        : null;
      const retryErr = mapYouTubeApiError(retry.status, retryBody, retry.headers);
      if (retryErr) throw retryErr;
      return retryBody as T;
    }

    throw err;
  }

  async function listLikedVideos(
    opts: { maxResults?: number } = {},
  ): Promise<YouTubeVideoSummary[]> {
    const body = await request<{ items?: unknown[] }>('/videos', {
      query: {
        part: 'snippet,contentDetails',
        myRating: 'like',
        maxResults: opts.maxResults ?? 25,
      },
    });
    return mapVideoItems(body?.items ?? []);
  }

  async function listMyPlaylists(
    opts: { maxResults?: number } = {},
  ): Promise<YouTubePlaylistSummary[]> {
    const body = await request<{ items?: unknown[] }>('/playlists', {
      query: {
        part: 'snippet,contentDetails',
        mine: true,
        maxResults: opts.maxResults ?? 25,
      },
    });
    return mapPlaylistItems(body?.items ?? []);
  }

  async function search(
    q: string,
    opts: { maxResults?: number } = {},
  ): Promise<YouTubeSearchResult[]> {
    if (!q.trim()) return [];
    const body = await request<{ items?: unknown[] }>('/search', {
      query: {
        part: 'snippet',
        q,
        type: 'video',
        maxResults: opts.maxResults ?? 25,
      },
    });
    return mapSearchItems(body?.items ?? []);
  }

  async function listPlaylistItems(
    playlistId: string,
    opts: { maxResults?: number } = {},
  ): Promise<YouTubePlaylistItem[]> {
    if (!playlistId) return [];
    const body = await request<{ items?: unknown[] }>('/playlistItems', {
      query: {
        part: 'snippet,contentDetails',
        playlistId,
        maxResults: opts.maxResults ?? 50,
      },
    });
    return mapPlaylistItemRows(body?.items ?? []);
  }

  return { request, listLikedVideos, listMyPlaylists, listPlaylistItems, search };
}

// ---------- Mapping helpers ----------

function mapVideoItems(items: unknown[]): YouTubeVideoSummary[] {
  const out: YouTubeVideoSummary[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const id = typeof it['id'] === 'string' ? (it['id'] as string) : null;
    const snippet = it['snippet'] as Record<string, unknown> | undefined;
    const title = snippet && typeof snippet['title'] === 'string' ? (snippet['title'] as string) : null;
    if (!id || !title) continue;
    const channelTitle =
      snippet && typeof snippet['channelTitle'] === 'string'
        ? (snippet['channelTitle'] as string)
        : '';
    const thumbnailUrl = pickThumbnail(snippet?.['thumbnails']);
    const durationMs = parseISODuration(
      ((it['contentDetails'] as Record<string, unknown> | undefined)?.['duration'] as string) ??
        null,
    );
    out.push({ id, title, channelTitle, thumbnailUrl, durationMs });
  }
  return out;
}

function mapPlaylistItems(items: unknown[]): YouTubePlaylistSummary[] {
  const out: YouTubePlaylistSummary[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const id = typeof it['id'] === 'string' ? (it['id'] as string) : null;
    const snippet = it['snippet'] as Record<string, unknown> | undefined;
    const title = snippet && typeof snippet['title'] === 'string' ? (snippet['title'] as string) : null;
    if (!id || !title) continue;
    const itemCount =
      typeof (it['contentDetails'] as Record<string, unknown> | undefined)?.['itemCount'] === 'number'
        ? ((it['contentDetails'] as Record<string, unknown>)['itemCount'] as number)
        : 0;
    const thumbnailUrl = pickThumbnail(snippet?.['thumbnails']);
    out.push({ id, title, itemCount, thumbnailUrl });
  }
  return out;
}

function mapPlaylistItemRows(items: unknown[]): YouTubePlaylistItem[] {
  const out: YouTubePlaylistItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const snippet = it['snippet'] as Record<string, unknown> | undefined;
    const contentDetails = it['contentDetails'] as Record<string, unknown> | undefined;
    const videoId =
      contentDetails && typeof contentDetails['videoId'] === 'string'
        ? (contentDetails['videoId'] as string)
        : null;
    const title =
      snippet && typeof snippet['title'] === 'string' ? (snippet['title'] as string) : null;
    if (!videoId || !title) continue;
    const channelTitle =
      snippet && typeof snippet['videoOwnerChannelTitle'] === 'string'
        ? (snippet['videoOwnerChannelTitle'] as string)
        : snippet && typeof snippet['channelTitle'] === 'string'
          ? (snippet['channelTitle'] as string)
          : '';
    const thumbnailUrl = pickThumbnail(snippet?.['thumbnails']);
    out.push({ videoId, title, channelTitle, thumbnailUrl });
  }
  return out;
}

function mapSearchItems(items: unknown[]): YouTubeSearchResult[] {
  const out: YouTubeSearchResult[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const idObj = it['id'] as Record<string, unknown> | undefined;
    const videoId =
      idObj && typeof idObj['videoId'] === 'string' ? (idObj['videoId'] as string) : null;
    const snippet = it['snippet'] as Record<string, unknown> | undefined;
    const title = snippet && typeof snippet['title'] === 'string' ? (snippet['title'] as string) : null;
    if (!videoId || !title) continue;
    const channelTitle =
      snippet && typeof snippet['channelTitle'] === 'string'
        ? (snippet['channelTitle'] as string)
        : '';
    const thumbnailUrl = pickThumbnail(snippet?.['thumbnails']);
    out.push({ videoId, title, channelTitle, thumbnailUrl });
  }
  return out;
}

function pickThumbnail(t: unknown): string | null {
  if (!t || typeof t !== 'object') return null;
  const rec = t as Record<string, unknown>;
  for (const key of ['medium', 'high', 'default']) {
    const entry = rec[key];
    if (entry && typeof entry === 'object') {
      const url = (entry as Record<string, unknown>)['url'];
      if (typeof url === 'string') return url;
    }
  }
  return null;
}

// Parse ISO 8601 duration ("PT4M13S") → ms. Returns null for unparseable input.
export function parseISODuration(iso: string | null): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const s = m[3] ? parseInt(m[3], 10) : 0;
  return (h * 3600 + min * 60 + s) * 1000;
}

// ---------- Internals ----------

function buildUrl(p: string, query?: Record<string, string | number | boolean | undefined>): string {
  const base = p.startsWith('http') ? p : `${YOUTUBE_API}${p.startsWith('/') ? '' : '/'}${p}`;
  if (!query) return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function doFetch(
  url: string,
  opts: YouTubeRequestOptions,
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
    throw new YouTubeNetworkError(e);
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
