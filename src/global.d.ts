import type { AuthEvent, PlaybackState } from '../electron/types';

declare global {
  interface Window {
    neonStereo: {
      auth: {
        login(): Promise<void>;
        logout(): Promise<void>;
        getStatus(): Promise<{ kind: 'logged-in' | 'logged-out' }>;
        getToken(): Promise<string | null>;
        startDemo(): Promise<void>;
        exitDemo(): Promise<void>;
        onAuthChange(cb: (e: AuthEvent) => void): () => void;
      };
      player: {
        get(): Promise<PlaybackState>;
        play(): Promise<void>;
        pause(): Promise<void>;
        next(): Promise<void>;
        prev(): Promise<void>;
        seek(positionMs: number): Promise<void>;
        setVolume(percent: number): Promise<void>;
        onState(cb: (s: PlaybackState) => void): () => void;
      };
    };
  }
}

export {};
