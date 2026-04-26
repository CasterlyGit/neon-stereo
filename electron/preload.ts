import { contextBridge, ipcRenderer } from 'electron';
import type { AuthEvent, PlaybackState } from './types.js';

type AuthStatus = { kind: 'logged-in' | 'logged-out' };

const api = {
  auth: {
    login: (): Promise<void> => ipcRenderer.invoke('auth:login') as Promise<void>,
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout') as Promise<void>,
    getStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:getStatus') as Promise<AuthStatus>,
    getToken: (): Promise<string | null> => ipcRenderer.invoke('auth:getToken') as Promise<string | null>,
    onAuthChange(cb: (e: AuthEvent) => void): () => void {
      const handler = (_e: unknown, payload: AuthEvent): void => cb(payload);
      ipcRenderer.on('auth:changed', handler);
      return () => ipcRenderer.removeListener('auth:changed', handler);
    },
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
} as const;

export type NeonStereoAPI = typeof api;

contextBridge.exposeInMainWorld('neonStereo', api);
