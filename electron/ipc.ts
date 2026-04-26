import { ipcMain, shell, type BrowserWindow } from 'electron';
import { createOAuth, type OAuth } from './auth/oauth.js';
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
import { serializeError, type AuthEvent, type PlaybackState } from './types.js';

type WinGetter = () => BrowserWindow | null;

export function registerIpcHandlers(getWin: WinGetter): void {
  const clientId = process.env['SPOTIFY_CLIENT_ID'] ?? '';
  let mode: 'spotify' | 'demo' = process.env['NEON_DEMO'] === '1' ? 'demo' : 'spotify';

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

  const client = createSpotifyClient({
    fetch: globalThis.fetch,
    getAccessToken: () => oauth.getAccessToken(),
    refresh: () => oauth.refresh(),
  });

  const demoSession: DemoSession = createDemoSession();
  let demoPoller: DemoPollerHandle | null = null;

  const emitAuth = (ev: AuthEvent): void => {
    const w = getWin();
    if (w) w.webContents.send('auth:changed', ev);
  };

  oauth.on('auth-changed', emitAuth);
  demoSession.on('auth-changed', emitAuth);

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

  async function startDemo(): Promise<void> {
    if (mode === 'demo') return;
    stopPoller();
    mode = 'demo';
    demoSession.start();
    demoPoller = buildDemoPoller();
    attachPoller(demoPoller);
    await demoPoller.pollNow();
  }

  async function exitDemo(): Promise<void> {
    if (mode !== 'demo') return;
    stopPoller();
    demoPoller = null;
    mode = 'spotify';
    demoSession.exit();
    attachPoller(spotifyPoller);
  }

  // Boot the active poller for the initial mode.
  if (mode === 'demo') {
    demoSession.start();
    demoPoller = buildDemoPoller();
    attachPoller(demoPoller);
  } else {
    attachPoller(spotifyPoller);
  }

  // ---------- Auth ----------
  ipcMain.handle('auth:login', async () => {
    if (mode === 'demo') {
      throw serializeError(new Error('already in demo mode'));
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
    await oauth.logout();
  });
  ipcMain.handle('auth:getStatus', async () => {
    if (mode === 'demo') return { kind: 'logged-in' as const };
    const status = oauth.getStatus();
    if (status.kind === 'logged-in') return { kind: 'logged-in' as const };
    const stored = await getRefreshToken();
    return { kind: stored ? ('logged-in' as const) : ('logged-out' as const) };
  });
  ipcMain.handle('auth:getToken', async () => {
    if (mode === 'demo') return null;
    return oauth.getAccessToken();
  });
  ipcMain.handle('auth:startDemo', async () => {
    await startDemo();
  });
  ipcMain.handle('auth:exitDemo', async () => {
    await exitDemo();
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

  ipcMain.handle('player:get', async () => {
    if (mode === 'demo') {
      return demoPoller?.getState() ?? ({ kind: 'no-device' } as PlaybackState);
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
    return wrapSpotifyControl(() => client.request('/me/player/play', { method: 'PUT' }));
  });
  ipcMain.handle('player:pause', () => {
    if (mode === 'demo') return wrapDemoControl((p) => p.pause());
    return wrapSpotifyControl(() => client.request('/me/player/pause', { method: 'PUT' }));
  });
  ipcMain.handle('player:next', () => {
    if (mode === 'demo') return wrapDemoControl((p) => p.next());
    return wrapSpotifyControl(() => client.request('/me/player/next', { method: 'POST' }));
  });
  ipcMain.handle('player:prev', () => {
    if (mode === 'demo') return wrapDemoControl((p) => p.prev());
    return wrapSpotifyControl(() => client.request('/me/player/previous', { method: 'POST' }));
  });
  ipcMain.handle('player:seek', (_e, positionMs: number) => {
    if (mode === 'demo') return wrapDemoControl((p) => p.seek(positionMs));
    return wrapSpotifyControl(() =>
      client.request('/me/player/seek', { method: 'PUT', query: { position_ms: positionMs } }),
    );
  });
  ipcMain.handle('player:volume', (_e, percent: number) => {
    if (mode === 'demo') return wrapDemoControl((p) => p.setVolume(percent));
    return wrapSpotifyControl(() =>
      client.request('/me/player/volume', { method: 'PUT', query: { volume_percent: percent } }),
    );
  });
}
