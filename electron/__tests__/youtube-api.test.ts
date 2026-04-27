import { describe, it, expect } from 'vitest';
import {
  createYouTubeApiClient,
  mapYouTubeApiError,
  parseISODuration,
  YOUTUBE_API,
} from '../youtube/api.js';
import {
  YouTubeAuthExpiredError,
  YouTubeError,
  YouTubeForbiddenError,
  YouTubeRateLimitError,
  YouTubeServerError,
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

describe('mapYouTubeApiError', () => {
  it('200 → null', () => {
    expect(mapYouTubeApiError(200, { items: [] })).toBeNull();
  });

  it('401 → YouTubeAuthExpiredError', () => {
    const err = mapYouTubeApiError(401, { error: { message: 'expired' } });
    expect(err).toBeInstanceOf(YouTubeAuthExpiredError);
    expect(err?.code).toBe('YT_AUTH_EXPIRED');
  });

  it('403 → YouTubeForbiddenError', () => {
    const err = mapYouTubeApiError(403, { error: { message: 'no scope' } });
    expect(err).toBeInstanceOf(YouTubeForbiddenError);
    expect(err?.code).toBe('YT_FORBIDDEN');
  });

  it('429 with Retry-After → YouTubeRateLimitError', () => {
    const err = mapYouTubeApiError(429, null, headers({ 'Retry-After': '5' }));
    expect(err).toBeInstanceOf(YouTubeRateLimitError);
    expect((err as YouTubeRateLimitError).retryAfterSec).toBe(5);
  });

  it('429 without Retry-After → defaults to 1s', () => {
    const err = mapYouTubeApiError(429, null, headers({}));
    expect((err as YouTubeRateLimitError).retryAfterSec).toBe(1);
  });

  it('500 → YouTubeServerError', () => {
    const err = mapYouTubeApiError(500, null);
    expect(err).toBeInstanceOf(YouTubeServerError);
    expect(err?.status).toBe(500);
  });

  it('400 → generic YouTubeError surfacing the message', () => {
    const err = mapYouTubeApiError(400, { error: { message: 'bad part' } });
    expect(err).toBeInstanceOf(YouTubeError);
    expect(err).not.toBeInstanceOf(YouTubeAuthExpiredError);
    expect(err?.message).toBe('bad part');
  });
});

describe('parseISODuration', () => {
  it('PT4M13S → 253000ms', () => {
    expect(parseISODuration('PT4M13S')).toBe(253_000);
  });
  it('PT1H2M3S → 3,723,000ms', () => {
    expect(parseISODuration('PT1H2M3S')).toBe(3_723_000);
  });
  it('PT45S → 45000ms', () => {
    expect(parseISODuration('PT45S')).toBe(45_000);
  });
  it('garbage → null', () => {
    expect(parseISODuration('not a duration')).toBeNull();
    expect(parseISODuration(null)).toBeNull();
  });
});

describe('YouTubeApiClient.request — 401 refresh & retry', () => {
  it('first call 401, refresh, retry succeeds with new token', async () => {
    let token = 'OLD';
    let videoCalls = 0;
    let refreshCalls = 0;
    const fetchFake: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const auth = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
      if (url.startsWith(`${YOUTUBE_API}/videos`)) {
        videoCalls++;
        if (auth === 'Bearer OLD') {
          return new Response(
            JSON.stringify({ error: { code: 401, message: 'expired' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ) as Response;
        }
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }) as Response;
      }
      throw new Error('unexpected url ' + url);
    };
    const client = createYouTubeApiClient({
      fetch: fetchFake,
      getAccessToken: async () => token,
      refresh: async () => {
        refreshCalls++;
        token = 'NEW';
        return 'NEW';
      },
    });

    const out = await client.request<{ items: unknown[] }>('/videos', {
      query: { part: 'snippet', myRating: 'like' },
    });
    expect(out).toEqual({ items: [] });
    expect(videoCalls).toBe(2);
    expect(refreshCalls).toBe(1);
  });
});

describe('YouTubeApiClient — convenience methods', () => {
  it('listLikedVideos maps the videos.list response', async () => {
    let capturedUrl = '';
    const fetchFake: typeof fetch = async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'vid-1',
              snippet: {
                title: 'Liked Track',
                channelTitle: 'Some Channel',
                thumbnails: {
                  default: { url: 'https://img/d.jpg' },
                  medium: { url: 'https://img/m.jpg' },
                },
              },
              contentDetails: { duration: 'PT3M30S' },
            },
            { id: 'vid-2' /* missing snippet → filtered out */ },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as Response;
    };
    const client = createYouTubeApiClient({
      fetch: fetchFake,
      getAccessToken: async () => 'TOKEN',
      refresh: async () => {
        throw new Error('should not refresh');
      },
    });
    const out = await client.listLikedVideos();
    expect(out).toEqual([
      {
        id: 'vid-1',
        title: 'Liked Track',
        channelTitle: 'Some Channel',
        thumbnailUrl: 'https://img/m.jpg',
        durationMs: 210_000,
      },
    ]);
    expect(capturedUrl).toContain('myRating=like');
    expect(capturedUrl).toContain('part=snippet%2CcontentDetails');
  });

  it('listMyPlaylists maps the playlists.list response and asks for mine=true', async () => {
    let capturedUrl = '';
    const fetchFake: typeof fetch = async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'pl-1',
              snippet: {
                title: 'My Mix',
                thumbnails: { default: { url: 'https://img/d.jpg' } },
              },
              contentDetails: { itemCount: 12 },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as Response;
    };
    const client = createYouTubeApiClient({
      fetch: fetchFake,
      getAccessToken: async () => 'TOKEN',
      refresh: async () => {
        throw new Error('should not refresh');
      },
    });
    const out = await client.listMyPlaylists();
    expect(out).toEqual([
      { id: 'pl-1', title: 'My Mix', itemCount: 12, thumbnailUrl: 'https://img/d.jpg' },
    ]);
    expect(capturedUrl).toContain('mine=true');
  });

  it('search maps search.list response and skips items missing a videoId', async () => {
    let capturedUrl = '';
    const fetchFake: typeof fetch = async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(
        JSON.stringify({
          items: [
            {
              id: { kind: 'youtube#video', videoId: 'abc123' },
              snippet: {
                title: 'Hit Result',
                channelTitle: 'Channel',
                thumbnails: { medium: { url: 'https://img/h.jpg' } },
              },
            },
            { id: { kind: 'youtube#channel', channelId: 'c-1' }, snippet: { title: 'A Channel' } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as Response;
    };
    const client = createYouTubeApiClient({
      fetch: fetchFake,
      getAccessToken: async () => 'TOKEN',
      refresh: async () => {
        throw new Error('should not refresh');
      },
    });
    const out = await client.search('hello');
    expect(out).toEqual([
      {
        videoId: 'abc123',
        title: 'Hit Result',
        channelTitle: 'Channel',
        thumbnailUrl: 'https://img/h.jpg',
      },
    ]);
    expect(capturedUrl).toContain('q=hello');
    expect(capturedUrl).toContain('type=video');
  });

  it('search short-circuits on empty query without hitting the network', async () => {
    let called = false;
    const fetchFake: typeof fetch = async () => {
      called = true;
      throw new Error('should not be called');
    };
    const client = createYouTubeApiClient({
      fetch: fetchFake,
      getAccessToken: async () => 'TOKEN',
      refresh: async () => 'TOKEN',
    });
    const out = await client.search('   ');
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it('listPlaylistItems maps playlistItems.list rows and pulls videoId from contentDetails', async () => {
    let capturedUrl = '';
    const fetchFake: typeof fetch = async (input) => {
      capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
      return new Response(
        JSON.stringify({
          items: [
            {
              snippet: {
                title: 'Track 1',
                videoOwnerChannelTitle: 'Owner',
                thumbnails: { medium: { url: 'https://img/1.jpg' } },
              },
              contentDetails: { videoId: 'vid-1' },
            },
            // Missing videoId → dropped.
            { snippet: { title: 'Orphan' }, contentDetails: {} },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as Response;
    };
    const client = createYouTubeApiClient({
      fetch: fetchFake,
      getAccessToken: async () => 'TOKEN',
      refresh: async () => {
        throw new Error('should not refresh');
      },
    });
    const out = await client.listPlaylistItems('PLxyz');
    expect(out).toEqual([
      {
        videoId: 'vid-1',
        title: 'Track 1',
        channelTitle: 'Owner',
        thumbnailUrl: 'https://img/1.jpg',
      },
    ]);
    expect(capturedUrl).toContain('playlistId=PLxyz');
  });

  it('listPlaylistItems short-circuits on empty playlistId', async () => {
    let called = false;
    const fetchFake: typeof fetch = async () => {
      called = true;
      throw new Error('should not be called');
    };
    const client = createYouTubeApiClient({
      fetch: fetchFake,
      getAccessToken: async () => 'TOKEN',
      refresh: async () => 'TOKEN',
    });
    const out = await client.listPlaylistItems('');
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});
