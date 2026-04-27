import { useEffect, useRef } from 'react';
import type { YouTubeControl } from '../../electron/youtube/poller';
import type { YouTubePlayerSnapshot } from '../../electron/youtube/mapper';

// Minimal types for the YouTube IFrame Player API surface we touch.
type YTPlayer = {
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  nextVideo(): void;
  previousVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(percent: number): void;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?: () => { video_id?: string; title?: string };
};

type YTPlayerEvent = { target: YTPlayer; data?: unknown };

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        opts: {
          height?: string | number;
          width?: string | number;
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: YTPlayerEvent) => void;
            onStateChange?: (e: YTPlayerEvent) => void;
            onError?: (e: YTPlayerEvent) => void;
          };
        },
      ) => YTPlayer;
      PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

let apiLoadingPromise: Promise<void> | null = null;

function loadIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadingPromise) return apiLoadingPromise;
  apiLoadingPromise = new Promise<void>((resolve) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = (): void => {
      prior?.();
      resolve();
    };
    if (!document.querySelector(`script[src="${IFRAME_API_SRC}"]`)) {
      const tag = document.createElement('script');
      tag.src = IFRAME_API_SRC;
      document.head.appendChild(tag);
    }
  });
  return apiLoadingPromise;
}

export function YouTubeEmbed(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const lastVideoRef = useRef<{ videoId: string; title?: string } | null>(null);

  useEffect(() => {
    let disposed = false;

    void loadIframeApi().then(() => {
      if (disposed || !containerRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '0',
        width: '0',
        playerVars: {
          enablejsapi: 1,
          playsinline: 1,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            pushSnapshot();
          },
          onStateChange: () => pushSnapshot(),
          onError: () => pushSnapshot(),
        },
      });
    });

    function pushSnapshot(): void {
      const p = playerRef.current;
      if (!p) return;
      let video = lastVideoRef.current;
      try {
        const data = p.getVideoData?.();
        if (data?.video_id) {
          video = { videoId: data.video_id, title: data.title };
          lastVideoRef.current = video;
        }
      } catch {
        /* getVideoData can throw before first load */
      }
      const snap: YouTubePlayerSnapshot = {
        playerState: safeNum(() => p.getPlayerState(), -1),
        currentTime: safeNum(() => p.getCurrentTime(), 0),
        duration: safeNum(() => p.getDuration(), 0),
        volume: safeNum(() => p.getVolume(), 100),
        video,
        ready: readyRef.current,
      };
      window.neonStereo._ytBridge.sendState(snap);
    }

    const offControl = window.neonStereo._ytBridge.onControl((cmd: YouTubeControl) => {
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      switch (cmd.kind) {
        case 'play':
          p.playVideo();
          break;
        case 'pause':
          p.pauseVideo();
          break;
        case 'next':
          // Main owns the queue; the embed has no native one.
          break;
        case 'prev':
          break;
        case 'seek':
          p.seekTo(cmd.positionMs / 1000, true);
          break;
        case 'volume':
          p.setVolume(Math.max(0, Math.min(100, cmd.percent)));
          break;
        case 'loadVideoId':
          lastVideoRef.current = { videoId: cmd.videoId };
          p.loadVideoById(cmd.videoId);
          break;
      }
      // Reflect immediately for responsive UI.
      setTimeout(pushSnapshot, 50);
    });

    const offReq = window.neonStereo._ytBridge.onRequestState(() => pushSnapshot());

    return () => {
      disposed = true;
      offControl();
      offReq();
    };
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      <div ref={containerRef} />
    </div>
  );
}

function safeNum(fn: () => number, fallback: number): number {
  try {
    const v = fn();
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
