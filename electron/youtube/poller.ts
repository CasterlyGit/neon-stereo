import type { PlaybackState } from '../types.js';
import { cadenceFor, type PollerHandle } from '../spotify/poller.js';
import { mapYouTubePlayerState, type YouTubePlayerSnapshot } from './mapper.js';

export type YouTubeControl =
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'seek'; positionMs: number }
  | { kind: 'volume'; percent: number }
  | { kind: 'loadVideoId'; videoId: string };

export type YouTubePollerDeps = {
  emit: (state: PlaybackState) => void;
  /** Send a control command to the renderer-side embed. */
  sendControl: (cmd: YouTubeControl) => void;
  /** Ask the embed to push a fresh state snapshot. */
  requestState: () => void;
  /** Advance/regress the queue when next()/prev() are issued. Returns the new videoId or null. */
  advanceQueue?: (dir: 'next' | 'prev') => string | null;
  now?: () => number;
};

export type YouTubePollerHandle = PollerHandle & {
  /** Renderer pushed an updated snapshot; re-emit as PlaybackState. */
  applySnapshot(snap: YouTubePlayerSnapshot): void;
  loadVideoId(videoId: string): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(positionMs: number): void;
  setVolume(percent: number): void;
  getState(): PlaybackState;
};

export function createYouTubePoller(deps: YouTubePollerDeps): YouTubePollerHandle {
  const now = deps.now ?? Date.now;
  let lastSnap: YouTubePlayerSnapshot = {
    playerState: -1,
    currentTime: 0,
    duration: 0,
    video: null,
    ready: false,
  };
  let lastState: PlaybackState = { kind: 'no-device' };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focused = true;
  let hidden = false;
  let stopped = true;

  function rebuildState(): PlaybackState {
    return mapYouTubePlayerState(lastSnap, now());
  }

  function schedule(): void {
    if (stopped) return;
    const ms = cadenceFor({ focused, hidden });
    if (ms === null) return;
    timer = setTimeout(tick, ms);
  }

  function tick(): void {
    timer = null;
    deps.requestState();
    schedule();
  }

  return {
    start(): void {
      stopped = false;
      tick();
    },
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    setFocus(f): void {
      focused = f;
      if (timer) {
        clearTimeout(timer);
        timer = null;
        schedule();
      }
    },
    setVisibility(v): void {
      hidden = !v;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!hidden && !stopped) schedule();
    },
    async pollNow(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      deps.requestState();
      schedule();
    },
    applySnapshot(snap: YouTubePlayerSnapshot): void {
      lastSnap = snap;
      lastState = rebuildState();
      deps.emit(lastState);
    },
    loadVideoId(videoId): void {
      deps.sendControl({ kind: 'loadVideoId', videoId });
    },
    play(): void {
      deps.sendControl({ kind: 'play' });
    },
    pause(): void {
      deps.sendControl({ kind: 'pause' });
    },
    next(): void {
      const id = deps.advanceQueue ? deps.advanceQueue('next') : null;
      if (id) deps.sendControl({ kind: 'loadVideoId', videoId: id });
      else deps.sendControl({ kind: 'next' });
    },
    prev(): void {
      const id = deps.advanceQueue ? deps.advanceQueue('prev') : null;
      if (id) deps.sendControl({ kind: 'loadVideoId', videoId: id });
      else deps.sendControl({ kind: 'prev' });
    },
    seek(positionMs): void {
      deps.sendControl({ kind: 'seek', positionMs });
    },
    setVolume(percent): void {
      deps.sendControl({ kind: 'volume', percent });
    },
    getState(): PlaybackState {
      return lastState;
    },
  };
}
