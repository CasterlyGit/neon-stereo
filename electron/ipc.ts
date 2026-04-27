import { ipcMain, shell, type BrowserWindow } from 'electron';
import { createOAuth, type OAuth } from './auth/oauth.js';
import {
  createGoogleOAuth,
  getGoogleRefreshToken,
  type GoogleOAuth,
} from './auth/google.js';
import { createSpotifyClient } from './spotify/client.js';
import {
  attachPoller,
  createPoller,
  mapPlaybackResponse,
  stopPoller,
  type PollerHandle,
} from './spotify/poller.js';
import { getRefreshToken } from './auth/keychain.js';
import { createDemoSession, type DemoSession } from './demo/session.js';
import { createDemoPoller, type DemoPollerHandle } from './demo/poller.js';
import {
  createYouTubePoller,
  type YouTubePollerHandle,
  type YouTubeControl,
} from './youtube/poller.js';
import { createQueue, type Queue } from './youtube/queue.js';
import {
  patchPreferences,
  readPreferences,
  type QueueItem,
} from './youtube/preferences.js';
import { type YouTubePlayerSnapshot } from './youtube/mapper.js';
import { createYouTubeApiClient, type YouTubeApiClient } from './youtube/api.js';
import {
  serializeError,
  YouTubeError,
  type AuthEvent,
  type PlaybackState,
  type Provider,
} from './types.js';

type WinGetter = () => BrowserWindow | null;

function envProvider(): Provider | null {
  const v = process.env['NEON_DEFAULT_PROVIDER'];
  if (v === 'spotify' || v === 'youtube' || v === 'demo') return v;
  return null;
}

function isProvider(v: unknown): v is Provider {
  return v === 'spotify' || v === 'youtube' || v === 'demo';
}

export function registerIpcHandlers(getWin: WinGetter): void {
  const clientId = process.env['SPOTIFY_CLIENT_ID'] ?? '';
  const googleClientId = process.env['GOOGLE_OAUTH_CLIENT_ID'] ?? '';

  // Boot mode: NEON_DEMO=1 wins. Else NEON_DEFAULT_PROVIDER. Else preferences (lazy below).
  // Else default 'spotify'. We resolve preferences async after handlers register.
  let mode: Provider = process.env['NEON_DEMO'] === '1' ? 'demo' : envProvider() ?? 'spotify';

  if (mode === 'spotify' && !clientId) {
    // eslint-disable-next-line no-console
    console.warn('[neon-stereo] SPOTIFY_CLIENT_ID not set; auth.login will fail.');
  }

  const emitPlayerState = (state: PlaybackState): void => {
    const w = getWin();
    if (w) w.webContents.send('player:state', state);
  };

  const oauth: OAuth = createOAuth({
    clientId,
    fetch: globalThis.fetch,
    openExternal: (url: string) => shell.openExternal(url),
  });

  const googleOAuth: GoogleOAuth = createGoogleOAuth({
    clientId: googleClientId,
    fetch: globalThis.fetch,
    openExternal: (url: string) => shell.openExternal(url),
  });

  const client = createSpotifyClient({
    fetch: globalThis.fetch,
    getAccessToken: () => oauth.getAccessToken(),
    refresh: () => oauth.refresh(),
  });

  const ytApi: YouTubeApiClient = createYouTubeApiClient({
    fetch: globalThis.fetch,
    getAccessToken: () => googleOAuth.getAccessToken(),
    refresh: () => googleOAuth.refresh(),
  });

  const demoSession: DemoSession = createDemoSession();
  let demoPoller: DemoPollerHandle | null = null;

  const ytSession = createDemoSession(); // re-use shape: tracks logged-in/out
  let youtubePoller: YouTubePollerHandle | null = null;
  let ytQueue: Queue = createQueue();

  const emitAuth = (ev: AuthEvent): void => {
    const w = getWin();
    if (w) w.webContents.send('auth:changed', ev);
  };

  oauth.on('auth-changed', emitAuth);
  googleOAuth.on('auth-changed', emitAuth);
  demoSession.on('auth-changed', emitAuth);
  ytSession.on('auth-changed', emitAuth);

  const spotifyPoller: PollerHandle = createPoller({
    fetchPlaybackState: async (): Promise<PlaybackState> => {
      const token = await oauth.getAccessToken();
      if (!token) return { kind: 'no-device' };
      try {
        const res = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = res.status === 204 ? null : await res.json().catch(() => null);
        return mapPlaybackResponse(res.status, body);
      } catch {
        return { kind: 'no-device' };
      }
    },
    emit: emitPlayerState,
  });

  function buildDemoPoller(): DemoPollerHandle {
    return createDemoPoller({ emit: emitPlayerState });
  }

  function sendToRenderer(channel: string, payload?: unknown): void {
    const w = getWin();
    if (w) w.webContents.send(channel, payload);
  }

  function buildYouTubePoller(initialQueue: QueueItem[]): YouTubePollerHandle {
    ytQueue = createQueue({
      initial: initialQueue,
      onChange: (items) => {
        void patchPreferences({ ytQueue: items });
      },
    });
    return createYouTubePoller({
      emit: emitPlayerState,
      sendControl: (cmd: YouTubeControl) => sendToRenderer('yt:control', cmd),
      requestState: () => sendToRenderer('yt:request-state'),
      advanceQueue: (dir) => {
        const item = dir === 'next' ? ytQueue.next() : ytQueue.prev();
        return item ? item.videoId : null;
      },
    });
  }

  async function startDemo(): Promise<void> {
    if (mode === 'demo') return;
    await deactivateActive();
    mode = 'demo';
    demoSession.start();
    demoPoller = buildDemoPoller();
    attachPoller(demoPoller);
    await demoPoller.pollNow();
    await patchPreferences({ lastProvider: 'demo' });
  }

  async function exitDemo(): Promise<void> {
    if (mode !== 'demo') return;
    stopPoller();
    demoPoller = null;
    mode = 'spotify';
    demoSession.exit();
    attachPoller(spotifyPoller);
    await patchPreferences({ lastProvider: 'spotify' });
  }

  async function startYouTube(): Promise<void> {
    if (mode === 'youtube') return;
    await deactivateActive();
    mode = 'youtube';
    const prefs = await readPreferences();
    youtubePoller = buildYouTubePoller(prefs.ytQueue);
    attachPoller(youtubePoller);
    ytSession.start();
    await patchPreferences({ lastProvider: 'youtube' });
  }

  async function exitYouTube(): Promise<void> {
    if (mode !== 'youtube') return;
    stopPoller();
    youtubePoller = null;
    mode = 'spotify';
    ytSession.exit();
    attachPoller(spotifyPoller);
    await patchPreferences({ lastProvider: 'spotify' });
  }

  async function deactivateActive(): Promise<void> {
    if (mode === 'demo') {
      stopPoller();
      demoPoller = null;
      demoSession.exit();
    } else if (mode === 'youtube') {
      stopPoller();
      youtubePoller = null;
      ytSession.exit();
    } else {
      stopPoller();
    }
  }

  // Boot the active poller for the initial mode.
  if (mode === 'demo') {
    demoSession.start();
    demoPoller = buildDemoPoller();
    attachPoller(demoPoller);
  } else if (mode === 'youtube') {
    youtubePoller = buildYouTubePoller([]);
    attachPoller(youtubePoller);
    ytSession.start();
    // Hydrate the persisted queue asynchronously without blocking boot.
    void readPreferences().then((prefs) => {
      for (const item of prefs.ytQueue) ytQueue.add(item);
    });
  } else {
    attachPoller(spotifyPoller);
  }

  // ---------- Auth ----------
  ipcMain.handle('auth:login', async () => {
    if (mode === 'demo') {
      throw serializeError(new Error('already in demo mode'));
    }
    if (mode === 'youtube') {
      throw serializeError(new Error('already in youtube mode'));
    }
    try {
      await oauth.login();
      void spotifyPoller.pollNow();
    } catch (e) {
      throw serializeError(e);
    }
  });
  ipcMain.handle('auth:logout', async () => {
    if (mode === 'demo') {
      await exitDemo();
      return;
    }
    if (mode === 'youtube') {
      await exitYouTube();
      return;
    }
    await oauth.logout();
  });
  ipcMain.handle('auth:getStatus', async () => {
    if (mode === 'demo' || mode === 'youtube') return { kind: 'logged-in' as const };
    const status = oauth.getStatus();
    if (status.kind === 'logged-in') return { kind: 'logged-in' as const };
    const stored = await getRefreshToken();
    if (stored) return { kind: 'logged-in' as const };
    // A stored Google refresh token means a previously signed-in YouTube session.
    const storedGoogle = await getGoogleRefreshToken();
    return { kind: storedGoogle ? ('logged-in' as const) : ('logged-out' as const) };
  });
  ipcMain.handle('auth:getToken', async () => {
    if (mode === 'demo' || mode === 'youtube') return null;
    return oauth.getAccessToken();
  });
  ipcMain.handle('auth:startDemo', async () => {
    await startDemo();
  });
  ipcMain.handle('auth:exitDemo', async () => {
    await exitDemo();
  });
  ipcMain.handle('auth:startYouTube', async () => {
    await startYouTube();
  });
  ipcMain.handle('auth:exitYouTube', async () => {
    await exitYouTube();
  });
  // Google PKCE sign-in for YouTube. After a successful login we land in youtube mode
  // (no API calls or playback yet — see issue #15 ACs).
  ipcMain.handle('auth:googleLogin', async () => {
    if (!googleClientId) {
      throw serializeError(
        new YouTubeError(
          'YouTube sign-in is not configured: set GOOGLE_OAUTH_CLIENT_ID and restart.',
          { code: 'GOOGLE_NOT_CONFIGURED' },
        ),
      );
    }
    try {
      await googleOAuth.login();
    } catch (e) {
      throw serializeError(e);
    }
    await startYouTube();
  });
  ipcMain.handle('auth:googleLogout', async () => {
    await googleOAuth.logout();
    if (mode === 'youtube') await exitYouTube();
  });
  ipcMain.handle('auth:getGoogleStatus', async () => {
    const status = googleOAuth.getStatus();
    if (status.kind === 'logged-in') return { kind: 'logged-in' as const };
    const stored = await getGoogleRefreshToken();
    return { kind: stored ? ('logged-in' as const) : ('logged-out' as const) };
  });

  // ---------- Provider routing ----------
  ipcMain.handle('provider:getActive', async () => mode);
  ipcMain.handle('provider:setActive', async (_e, name: unknown) => {
    if (!isProvider(name)) throw serializeError(new Error('invalid provider'));
    if (name === mode) return;
    if (name === 'demo') {
      await startDemo();
    } else if (name === 'youtube') {
      await startYouTube();
    } else {
      // spotify
      if (mode === 'demo') await exitDemo();
      else if (mode === 'youtube') await exitYouTube();
    }
  });

  // ---------- YouTube Data API ----------
  // Reads off the signed-in user's Google OAuth tokens (issue #15). Each handler
  // refuses unless we're actually in youtube mode so the renderer can't fish for
  // a token from any other state.
  const requireYouTubeMode = (): void => {
    if (mode !== 'youtube') {
      throw new YouTubeError('youtube mode is not active', { code: 'YT_NOT_ACTIVE' });
    }
  };
  ipcMain.handle('yt:library', async (_e, payload: unknown) => {
    try {
      requireYouTubeMode();
      const max = (payload as { maxResults?: unknown } | null)?.maxResults;
      return await ytApi.listLikedVideos({
        maxResults: typeof max === 'number' ? max : undefined,
      });
    } catch (e) {
      throw serializeError(e);
    }
  });
  ipcMain.handle('yt:playlists', async (_e, payload: unknown) => {
    try {
      requireYouTubeMode();
      const max = (payload as { maxResults?: unknown } | null)?.maxResults;
      return await ytApi.listMyPlaylists({
        maxResults: typeof max === 'number' ? max : undefined,
      });
    } catch (e) {
      throw serializeError(e);
    }
  });
  ipcMain.handle('yt:search', async (_e, payload: unknown) => {
    try {
      requireYouTubeMode();
      const q = (payload as { q?: unknown } | null)?.q;
      const max = (payload as { maxResults?: unknown } | null)?.maxResults;
      if (typeof q !== 'string') throw new YouTubeError('search query is required');
      return await ytApi.search(q, {
        maxResults: typeof max === 'number' ? max : undefined,
      });
    } catch (e) {
      throw serializeError(e);
    }
  });
  ipcMain.handle('yt:playlistItems', async (_e, payload: unknown) => {
    try {
      requireYouTubeMode();
      const playlistId = (payload as { playlistId?: unknown } | null)?.playlistId;
      const max = (payload as { maxResults?: unknown } | null)?.maxResults;
      if (typeof playlistId !== 'string' || !playlistId) {
        throw new YouTubeError('playlistId is required');
      }
      return await ytApi.listPlaylistItems(playlistId, {
        maxResults: typeof max === 'number' ? max : undefined,
      });
    } catch (e) {
      throw serializeError(e);
    }
  });
  // Playback handoff: queue a video then ask the embed to load + play it.
  ipcMain.handle('yt:playVideo', async (_e, payload: unknown) => {
    try {
      requireYouTubeMode();
      const p = payload as { videoId?: unknown; title?: unknown; durationMs?: unknown } | null;
      const videoId = p?.videoId;
      if (typeof videoId !== 'string' || !videoId) {
        throw new YouTubeError('videoId is required');
      }
      const item: QueueItem = { videoId };
      if (typeof p?.title === 'string') item.title = p.title;
      if (typeof p?.durationMs === 'number') item.durationMs = p.durationMs;
      ytQueue.add(item);
      if (youtubePoller) {
        sendToRenderer('yt:control', { kind: 'loadVideoId', videoId });
        youtubePoller.play();
      }
      return null;
    } catch (e) {
      throw serializeError(e);
    }
  });

  // ---------- YouTube embed bridge ----------
  ipcMain.handle('yt:getQueue', async () => ytQueue.list());

  // Renderer pushes player snapshots; main re-emits as PlaybackState.
  ipcMain.on('yt:state', (_e, snap: YouTubePlayerSnapshot) => {
    if (mode !== 'youtube' || !youtubePoller) return;
    if (!snap || typeof snap !== 'object') return;
    youtubePoller.applySnapshot(snap);
  });

  // ---------- Player ----------
  const wrapSpotifyControl = (
    handler: () => Promise<unknown>,
  ): Promise<unknown> =>
    handler()
      .then((v) => {
        void spotifyPoller.pollNow();
        return v ?? null;
      })
      .catch((e) => {
        throw serializeError(e);
      });

  const wrapDemoControl = (mutate: (p: DemoPollerHandle) => void): Promise<null> => {
    if (!demoPoller) return Promise.resolve(null);
    mutate(demoPoller);
    void demoPoller.pollNow();
    return Promise.resolve(null);
  };

  const wrapYouTubeControl = (mutate: (p: YouTubePollerHandle) => void): Promise<null> => {
    if (!youtubePoller) return Promise.resolve(null);
    mutate(youtubePoller);
    return Promise.resolve(null);
  };

  ipcMain.handle('player:get', async () => {
    if (mode === 'demo') {
      return demoPoller?.getState() ?? ({ kind: 'no-device' } as PlaybackState);
    }
    if (mode === 'youtube') {
      return youtubePoller?.getState() ?? ({ kind: 'no-device' } as PlaybackState);
    }
    const token = await oauth.getAccessToken();
    if (!token) return { kind: 'no-device' } as PlaybackState;
    try {
      const res = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      return mapPlaybackResponse(res.status, body);
    } catch (e) {
      throw serializeError(e);
    }
  });

  ipcMain.handle('player:play', () => {
    if (mode === 'demo') return wrapDemoControl((p) => p.play());
    if (mode === 'youtube') return wrapYouTubeControl((p) => p.play());
    return wrapSpotifyControl(() => client.request('/me/player/play', { method: 'PUT' }));
  });
  ipcMain.handle('player:pause', () => {
    if (mode === 'demo') return wrapDemoControl((p) => p.pause());
    if (mode === 'youtube') return wrapYouTubeControl((p) => p.pause());
    return wrapSpotifyControl(() => client.request('/me/player/pause', { method: 'PUT' }));
  });
  ipcMain.handle('player:next', () => {
    if (mode === 'demo') return wrapDemoControl((p) => p.next());
    if (mode === 'youtube') return wrapYouTubeControl((p) => p.next());
    return wrapSpotifyControl(() => client.request('/me/player/next', { method: 'POST' }));
  });
  ipcMain.handle('player:prev', () => {
    if (mode === 'demo') return wrapDemoControl((p) => p.prev());
    if (mode === 'youtube') return wrapYouTubeControl((p) => p.prev());
    return wrapSpotifyControl(() => client.request('/me/player/previous', { method: 'POST' }));
  });
  ipcMain.handle('player:seek', (_e, positionMs: number) => {
    if (mode === 'demo') return wrapDemoControl((p) => p.seek(positionMs));
    if (mode === 'youtube') return wrapYouTubeControl((p) => p.seek(positionMs));
    return wrapSpotifyControl(() =>
      client.request('/me/player/seek', { method: 'PUT', query: { position_ms: positionMs } }),
    );
  });
  ipcMain.handle('player:volume', (_e, percent: number) => {
    if (mode === 'demo') return wrapDemoControl((p) => p.setVolume(percent));
    if (mode === 'youtube') return wrapYouTubeControl((p) => p.setVolume(percent));
    return wrapSpotifyControl(() =>
      client.request('/me/player/volume', { method: 'PUT', query: { volume_percent: percent } }),
    );
  });
}
