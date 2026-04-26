import { ipcMain, shell, type BrowserWindow } from 'electron';
import { createOAuth, type OAuth } from './auth/oauth.js';
import { createSpotifyClient } from './spotify/client.js';
import { attachPoller, createPoller, mapPlaybackResponse } from './spotify/poller.js';
import { getRefreshToken } from './auth/keychain.js';
import { serializeError, type AuthEvent, type PlaybackState } from './types.js';

type WinGetter = () => BrowserWindow | null;

export function registerIpcHandlers(getWin: WinGetter): void {
  const clientId = process.env['SPOTIFY_CLIENT_ID'] ?? '';
  if (!clientId) {
    // eslint-disable-next-line no-console
    console.warn('[neon-stereo] SPOTIFY_CLIENT_ID not set; auth.login will fail.');
  }

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

  // Forward auth events to renderer.
  oauth.on('auth-changed', (ev: AuthEvent) => {
    const w = getWin();
    if (w) w.webContents.send('auth:changed', ev);
  });

  // Boot poller — fetches state via the client.
  const poller = createPoller({
    fetchPlaybackState: async (): Promise<PlaybackState> => {
      // Hit the API only if we have a refresh token (logged in). Otherwise no-device.
      const token = await oauth.getAccessToken();
      if (!token) return { kind: 'no-device' };
      try {
        // Issue raw fetch to capture the 204 status.
        const res = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = res.status === 204 ? null : await res.json().catch(() => null);
        return mapPlaybackResponse(res.status, body);
      } catch {
        return { kind: 'no-device' };
      }
    },
    emit: (state) => {
      const w = getWin();
      if (w) w.webContents.send('player:state', state);
    },
  });
  attachPoller(poller);

  // ---------- Auth ----------
  ipcMain.handle('auth:login', async () => {
    try {
      await oauth.login();
      // After successful login, force an immediate poll so the dashboard fills in fast.
      void poller.pollNow();
    } catch (e) {
      throw serializeError(e);
    }
  });
  ipcMain.handle('auth:logout', async () => {
    await oauth.logout();
  });
  ipcMain.handle('auth:getStatus', async () => {
    const status = oauth.getStatus();
    if (status.kind === 'logged-in') return { kind: 'logged-in' as const };
    // Even when in-memory is logged-out, we may have a stored refresh token.
    const stored = await getRefreshToken();
    return { kind: stored ? ('logged-in' as const) : ('logged-out' as const) };
  });
  ipcMain.handle('auth:getToken', async () => {
    return oauth.getAccessToken();
  });

  // ---------- Player ----------
  const wrapControl = (
    handler: () => Promise<unknown>,
  ): Promise<unknown> =>
    handler()
      .then((v) => {
        // Optimistic refresh of state.
        void poller.pollNow();
        return v ?? null;
      })
      .catch((e) => {
        throw serializeError(e);
      });

  ipcMain.handle('player:get', async () => {
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

  ipcMain.handle('player:play', () => wrapControl(() => client.request('/me/player/play', { method: 'PUT' })));
  ipcMain.handle('player:pause', () => wrapControl(() => client.request('/me/player/pause', { method: 'PUT' })));
  ipcMain.handle('player:next', () => wrapControl(() => client.request('/me/player/next', { method: 'POST' })));
  ipcMain.handle('player:prev', () => wrapControl(() => client.request('/me/player/previous', { method: 'POST' })));
  ipcMain.handle('player:seek', (_e, positionMs: number) =>
    wrapControl(() =>
      client.request('/me/player/seek', { method: 'PUT', query: { position_ms: positionMs } }),
    ),
  );
  ipcMain.handle('player:volume', (_e, percent: number) =>
    wrapControl(() =>
      client.request('/me/player/volume', { method: 'PUT', query: { volume_percent: percent } }),
    ),
  );
}
