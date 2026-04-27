import { contextBridge, ipcRenderer } from 'electron';
import { IPC_ERROR_TAG, type AuthEvent, type PlaybackState, type Provider } from './types.js';
import type { QueueItem } from './youtube/preferences.js';
import type { YouTubeControl } from './youtube/poller.js';
import type { YouTubePlayerSnapshot } from './youtube/mapper.js';
import type {
  YouTubePlaylistItem,
  YouTubePlaylistSummary,
  YouTubeSearchResult,
  YouTubeVideoSummary,
} from './youtube/api.js';

type AuthStatus = { kind: 'logged-in' | 'logged-out' };

// Electron wraps thrown errors so the renderer sees a generic `Error invoking
// remote method '...': <message>`. Custom properties on the thrown value are
// dropped, which costs us the structured `code`/`status` we use to render
// friendly UI messages. Main encodes those fields with `IPC_ERROR_TAG` in the
// error message; here we extract and re-attach them.
function rethrowIpcError(e: unknown): never {
  const raw = e instanceof Error ? e.message : String(e);
  const idx = raw.indexOf(IPC_ERROR_TAG);
  if (idx >= 0) {
    const tail = raw.slice(idx + IPC_ERROR_TAG.length);
    try {
      const parsed = JSON.parse(tail) as { code?: string; message?: string; status?: number };
      if (typeof parsed.message === 'string') {
        throw Object.assign(new Error(parsed.message), {
          code: parsed.code ?? 'UNKNOWN',
          status: typeof parsed.status === 'number' ? parsed.status : 0,
        });
      }
    } catch (parseErr) {
      if (parseErr instanceof Error && 'code' in parseErr) throw parseErr;
    }
  }
  throw Object.assign(new Error(raw), { code: 'UNKNOWN', status: 0 });
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return (ipcRenderer.invoke(channel, ...args) as Promise<T>).catch(rethrowIpcError);
}

const api = {
  auth: {
    login: (): Promise<void> => call('auth:login'),
    logout: (): Promise<void> => call('auth:logout'),
    getStatus: (): Promise<AuthStatus> => call('auth:getStatus'),
    getToken: (): Promise<string | null> => call('auth:getToken'),
    startDemo: (): Promise<void> => call('auth:startDemo'),
    exitDemo: (): Promise<void> => call('auth:exitDemo'),
    startYouTube: (): Promise<void> => call('auth:startYouTube'),
    exitYouTube: (): Promise<void> => call('auth:exitYouTube'),
    googleLogin: (): Promise<void> => call('auth:googleLogin'),
    googleLogout: (): Promise<void> => call('auth:googleLogout'),
    getGoogleStatus: (): Promise<AuthStatus> => call('auth:getGoogleStatus'),
    onAuthChange(cb: (e: AuthEvent) => void): () => void {
      const handler = (_e: unknown, payload: AuthEvent): void => cb(payload);
      ipcRenderer.on('auth:changed', handler);
      return () => ipcRenderer.removeListener('auth:changed', handler);
    },
  },
  provider: {
    getActive: (): Promise<Provider> => call('provider:getActive'),
    setActive: (name: Provider): Promise<void> => call('provider:setActive', name),
  },
  youtube: {
    getQueue: (): Promise<QueueItem[]> => call('yt:getQueue'),
    library: (opts?: { maxResults?: number }): Promise<YouTubeVideoSummary[]> =>
      call('yt:library', opts ?? {}),
    playlists: (opts?: { maxResults?: number }): Promise<YouTubePlaylistSummary[]> =>
      call('yt:playlists', opts ?? {}),
    search: (q: string, opts?: { maxResults?: number }): Promise<YouTubeSearchResult[]> =>
      call('yt:search', { q, ...(opts ?? {}) }),
    playlistItems: (
      playlistId: string,
      opts?: { maxResults?: number },
    ): Promise<YouTubePlaylistItem[]> => call('yt:playlistItems', { playlistId, ...(opts ?? {}) }),
    playVideo: (item: { videoId: string; title?: string; durationMs?: number }): Promise<void> =>
      call('yt:playVideo', item),
  },
  player: {
    get: (): Promise<PlaybackState> => call('player:get'),
    play: (): Promise<void> => call('player:play'),
    pause: (): Promise<void> => call('player:pause'),
    next: (): Promise<void> => call('player:next'),
    prev: (): Promise<void> => call('player:prev'),
    seek: (positionMs: number): Promise<void> => call('player:seek', positionMs),
    setVolume: (percent: number): Promise<void> => call('player:volume', percent),
    onState(cb: (s: PlaybackState) => void): () => void {
      const handler = (_e: unknown, payload: PlaybackState): void => cb(payload);
      ipcRenderer.on('player:state', handler);
      return () => ipcRenderer.removeListener('player:state', handler);
    },
  },
  // Internal bridge between main and the YouTubeEmbed component.
  // Not for application code — embed-only.
  _ytBridge: {
    onControl(cb: (cmd: YouTubeControl) => void): () => void {
      const handler = (_e: unknown, payload: YouTubeControl): void => cb(payload);
      ipcRenderer.on('yt:control', handler);
      return () => ipcRenderer.removeListener('yt:control', handler);
    },
    onRequestState(cb: () => void): () => void {
      const handler = (): void => cb();
      ipcRenderer.on('yt:request-state', handler);
      return () => ipcRenderer.removeListener('yt:request-state', handler);
    },
    sendState(snap: YouTubePlayerSnapshot): void {
      ipcRenderer.send('yt:state', snap);
    },
  },
} as const;

export type NeonStereoAPI = typeof api;

contextBridge.exposeInMainWorld('neonStereo', api);
