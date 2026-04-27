import { contextBridge, ipcRenderer } from 'electron';
import type { AuthEvent, PlaybackState, Provider } from './types.js';
import type { QueueItem } from './youtube/preferences.js';
import type { YouTubeControl } from './youtube/poller.js';
import type { YouTubePlayerSnapshot } from './youtube/mapper.js';

type AuthStatus = { kind: 'logged-in' | 'logged-out' };

const api = {
  auth: {
    login: (): Promise<void> => ipcRenderer.invoke('auth:login') as Promise<void>,
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout') as Promise<void>,
    getStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:getStatus') as Promise<AuthStatus>,
    getToken: (): Promise<string | null> => ipcRenderer.invoke('auth:getToken') as Promise<string | null>,
    startDemo: (): Promise<void> => ipcRenderer.invoke('auth:startDemo') as Promise<void>,
    exitDemo: (): Promise<void> => ipcRenderer.invoke('auth:exitDemo') as Promise<void>,
    startYouTube: (): Promise<void> => ipcRenderer.invoke('auth:startYouTube') as Promise<void>,
    exitYouTube: (): Promise<void> => ipcRenderer.invoke('auth:exitYouTube') as Promise<void>,
    googleLogin: (): Promise<void> => ipcRenderer.invoke('auth:googleLogin') as Promise<void>,
    googleLogout: (): Promise<void> => ipcRenderer.invoke('auth:googleLogout') as Promise<void>,
    getGoogleStatus: (): Promise<AuthStatus> =>
      ipcRenderer.invoke('auth:getGoogleStatus') as Promise<AuthStatus>,
    onAuthChange(cb: (e: AuthEvent) => void): () => void {
      const handler = (_e: unknown, payload: AuthEvent): void => cb(payload);
      ipcRenderer.on('auth:changed', handler);
      return () => ipcRenderer.removeListener('auth:changed', handler);
    },
  },
  provider: {
    getActive: (): Promise<Provider> => ipcRenderer.invoke('provider:getActive') as Promise<Provider>,
    setActive: (name: Provider): Promise<void> =>
      ipcRenderer.invoke('provider:setActive', name) as Promise<void>,
  },
  youtube: {
    getQueue: (): Promise<QueueItem[]> =>
      ipcRenderer.invoke('yt:getQueue') as Promise<QueueItem[]>,
  },
  player: {
    get: (): Promise<PlaybackState> => ipcRenderer.invoke('player:get') as Promise<PlaybackState>,
    play: (): Promise<void> => ipcRenderer.invoke('player:play') as Promise<void>,
    pause: (): Promise<void> => ipcRenderer.invoke('player:pause') as Promise<void>,
    next: (): Promise<void> => ipcRenderer.invoke('player:next') as Promise<void>,
    prev: (): Promise<void> => ipcRenderer.invoke('player:prev') as Promise<void>,
    seek: (positionMs: number): Promise<void> =>
      ipcRenderer.invoke('player:seek', positionMs) as Promise<void>,
    setVolume: (percent: number): Promise<void> =>
      ipcRenderer.invoke('player:volume', percent) as Promise<void>,
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
