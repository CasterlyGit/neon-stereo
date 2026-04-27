import type { AuthEvent, PlaybackState, Provider } from '../electron/types';
import type { QueueItem } from '../electron/youtube/preferences';
import type { YouTubeControl } from '../electron/youtube/poller';
import type { YouTubePlayerSnapshot } from '../electron/youtube/mapper';
import type {
  YouTubePlaylistItem,
  YouTubePlaylistSummary,
  YouTubeSearchResult,
  YouTubeVideoSummary,
} from '../electron/youtube/api';

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
        googleLogin(): Promise<void>;
        googleLogout(): Promise<void>;
        getGoogleStatus(): Promise<{ kind: 'logged-in' | 'logged-out' }>;
        onAuthChange(cb: (e: AuthEvent) => void): () => void;
      };
      provider: {
        getActive(): Promise<Provider>;
        setActive(name: Provider): Promise<void>;
      };
      youtube: {
        getQueue(): Promise<QueueItem[]>;
        library(opts?: { maxResults?: number }): Promise<YouTubeVideoSummary[]>;
        playlists(opts?: { maxResults?: number }): Promise<YouTubePlaylistSummary[]>;
        playlistItems(
          playlistId: string,
          opts?: { maxResults?: number },
        ): Promise<YouTubePlaylistItem[]>;
        search(q: string, opts?: { maxResults?: number }): Promise<YouTubeSearchResult[]>;
        playVideo(item: { videoId: string; title?: string; durationMs?: number }): Promise<void>;
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
