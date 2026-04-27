import type { AuthEvent, PlaybackState, Provider } from '../electron/types';
import type { QueueItem } from '../electron/youtube/preferences';
import type { YouTubeControl } from '../electron/youtube/poller';
import type { YouTubePlayerSnapshot } from '../electron/youtube/mapper';

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
        startYouTube(): Promise<void>;
        exitYouTube(): Promise<void>;
        onAuthChange(cb: (e: AuthEvent) => void): () => void;
      };
      provider: {
        getActive(): Promise<Provider>;
        setActive(name: Provider): Promise<void>;
      };
      youtube: {
        loadVideoId(videoId: string): Promise<void>;
        getQueue(): Promise<QueueItem[]>;
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
      _ytBridge: {
        onControl(cb: (cmd: YouTubeControl) => void): () => void;
        onRequestState(cb: () => void): () => void;
        sendState(snap: YouTubePlayerSnapshot): void;
      };
    };
  }
}

export {};
