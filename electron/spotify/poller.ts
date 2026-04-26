import type { BrowserWindow } from 'electron';
import type { PlaybackState, Track, Device } from '../types.js';

/** Pure cadence selector — testable without a clock. */
export function cadenceFor(visibility: { focused: boolean; hidden: boolean }): number | null {
  if (visibility.hidden) return null;
  return visibility.focused ? 1000 : 5000;
}

/**
 * Map Spotify's `/v1/me/player` response (or 204) into our PlaybackState.
 * status===204 → no-device. body.device==null → no-device. item==null or non-track → idle.
 */
export function mapPlaybackResponse(
  status: number,
  body: unknown,
  now: number = Date.now(),
): PlaybackState {
  if (status === 204) return { kind: 'no-device' };
  if (!body || typeof body !== 'object') return { kind: 'no-device' };
  const b = body as Record<string, unknown>;
  const device = mapDevice(b['device']);
  if (!device) return { kind: 'no-device' };

  const item = b['item'];
  if (!item || typeof item !== 'object') return { kind: 'idle', device };
  const itemRec = item as Record<string, unknown>;
  if ('type' in itemRec && itemRec['type'] !== 'track') return { kind: 'idle', device };

  const track = mapTrack(itemRec);
  if (!track) return { kind: 'idle', device };

  const isPlaying = b['is_playing'] === true;
  const positionMs = typeof b['progress_ms'] === 'number' ? (b['progress_ms'] as number) : 0;
  const shuffle = b['shuffle_state'] === true;
  const repeatRaw = b['repeat_state'];
  const repeat: 'off' | 'track' | 'context' =
    repeatRaw === 'track' || repeatRaw === 'context' ? repeatRaw : 'off';

  return {
    kind: isPlaying ? 'playing' : 'paused',
    device,
    track,
    positionMs,
    isPlaying,
    asOf: now,
    shuffle,
    repeat,
  };
}

function mapDevice(d: unknown): Device | null {
  if (!d || typeof d !== 'object') return null;
  const rec = d as Record<string, unknown>;
  const id = rec['id'];
  const name = rec['name'];
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return {
    id,
    name,
    type: typeof rec['type'] === 'string' ? (rec['type'] as string) : 'Unknown',
    volumePercent:
      typeof rec['volume_percent'] === 'number' ? (rec['volume_percent'] as number) : 0,
  };
}

function mapTrack(item: Record<string, unknown>): Track | null {
  const id = typeof item['id'] === 'string' ? (item['id'] as string) : null;
  const title = typeof item['name'] === 'string' ? (item['name'] as string) : null;
  if (!id || !title) return null;
  const artists = Array.isArray(item['artists'])
    ? (item['artists'] as Array<Record<string, unknown>>)
        .map((a) => (typeof a['name'] === 'string' ? (a['name'] as string) : null))
        .filter((s): s is string => !!s)
    : [];
  const album = item['album'];
  const albumName =
    album && typeof album === 'object' && typeof (album as Record<string, unknown>)['name'] === 'string'
      ? ((album as Record<string, unknown>)['name'] as string)
      : '';
  const images =
    album && typeof album === 'object' && Array.isArray((album as Record<string, unknown>)['images'])
      ? ((album as Record<string, unknown>)['images'] as Array<Record<string, unknown>>)
      : [];
  const artUrl =
    images.length > 0 && typeof images[0]['url'] === 'string' ? (images[0]['url'] as string) : null;
  const durationMs =
    typeof item['duration_ms'] === 'number' ? (item['duration_ms'] as number) : 0;
  return { id, title, artists, album: { name: albumName, artUrl }, durationMs };
}

// ---------- Active poller (uses real timers + Electron) ----------

export type PollerHandle = {
  start(): void;
  stop(): void;
  setFocus(focused: boolean): void;
  setVisibility(visible: boolean): void;
  pollNow(): Promise<void>;
};

export type PollerDeps = {
  fetchPlaybackState: () => Promise<PlaybackState>;
  emit: (state: PlaybackState) => void;
};

export function createPoller(deps: PollerDeps): PollerHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focused = true;
  let hidden = false;
  let stopped = true;

  function schedule(): void {
    if (stopped) return;
    const ms = cadenceFor({ focused, hidden });
    if (ms === null) return;
    timer = setTimeout(tick, ms);
  }

  async function tick(): Promise<void> {
    timer = null;
    try {
      const s = await deps.fetchPlaybackState();
      deps.emit(s);
    } catch {
      // swallow; keep last known state
    }
    schedule();
  }

  return {
    start(): void {
      stopped = false;
      // Fire one immediate tick.
      void tick();
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
      // Re-schedule on cadence change.
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
    pollNow(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return tick();
    },
  };
}

// ---------- Module-level singleton wired into main.ts ----------

let activePoller: PollerHandle | null = null;
type WindowGetter = () => BrowserWindow | null;

export function startPoller(_getWindow: WindowGetter): void {
  // Wired by ipc.ts which holds the OAuth + client. The main.ts passthrough is a no-op
  // until the IPC layer initializes. See ipc.ts -> attachPoller().
  void _getWindow;
}

export function stopPoller(): void {
  if (activePoller) {
    activePoller.stop();
    activePoller = null;
  }
}

export function setPollerFocus(focused: boolean): void {
  activePoller?.setFocus(focused);
}

export function setPollerVisibility(visible: boolean): void {
  activePoller?.setVisibility(visible);
}

export function attachPoller(handle: PollerHandle): void {
  activePoller = handle;
  handle.start();
}
