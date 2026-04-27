import type { PlaybackState, Track, Device } from '../types.js';
import { cadenceFor, type PollerHandle } from '../spotify/poller.js';
import { DEMO_DEVICE, DEMO_TRACKS } from './fixtures.js';

export type DemoPollerDeps = {
  emit: (state: PlaybackState) => void;
  tracks?: Track[];
  device?: Device;
  now?: () => number;
};

export type DemoPollerHandle = PollerHandle & {
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(positionMs: number): void;
  setVolume(percent: number): void;
  getState(): PlaybackState;
};

export function createDemoPoller(deps: DemoPollerDeps): DemoPollerHandle {
  const tracks = deps.tracks ?? DEMO_TRACKS;
  const device: Device = { ...(deps.device ?? DEMO_DEVICE) };
  const now = deps.now ?? Date.now;

  let index = 0;
  let isPlaying = true;
  let positionMs = 0;
  let asOf = now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focused = true;
  let hidden = false;
  let stopped = true;

  function currentTrack(): Track {
    return tracks[index] as Track;
  }

  function advanceClock(): void {
    const t = now();
    const elapsed = t - asOf;
    let effective = positionMs + (isPlaying ? elapsed : 0);
    if (isPlaying) {
      while (effective >= currentTrack().durationMs) {
        effective -= currentTrack().durationMs;
        index = (index + 1) % tracks.length;
      }
    }
    positionMs = effective;
    asOf = t;
  }

  function buildState(): PlaybackState {
    const track = currentTrack();
    return {
      kind: isPlaying ? 'playing' : 'paused',
      device: { ...device },
      track,
      positionMs,
      isPlaying,
      asOf,
      shuffle: false,
      repeat: 'off',
    };
  }

  function emitNow(): void {
    advanceClock();
    deps.emit(buildState());
  }

  function schedule(): void {
    if (stopped) return;
    const ms = cadenceFor({ focused, hidden });
    if (ms === null) return;
    timer = setTimeout(tick, ms);
  }

  function tick(): void {
    timer = null;
    emitNow();
    schedule();
  }

  return {
    start(): void {
      stopped = false;
      asOf = now();
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
      emitNow();
      schedule();
    },
    play(): void {
      if (isPlaying) return;
      advanceClock();
      isPlaying = true;
      asOf = now();
    },
    pause(): void {
      if (!isPlaying) return;
      advanceClock();
      isPlaying = false;
      asOf = now();
    },
    next(): void {
      advanceClock();
      index = (index + 1) % tracks.length;
      positionMs = 0;
      asOf = now();
    },
    prev(): void {
      advanceClock();
      index = (index - 1 + tracks.length) % tracks.length;
      positionMs = 0;
      asOf = now();
    },
    seek(ms): void {
      advanceClock();
      const dur = currentTrack().durationMs;
      positionMs = Math.max(0, Math.min(dur, ms));
      asOf = now();
    },
    setVolume(percent): void {
      device.volumePercent = Math.max(0, Math.min(100, percent));
    },
    getState(): PlaybackState {
      advanceClock();
      return buildState();
    },
  };
}
