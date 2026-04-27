import type { Device, PlaybackState, Track } from '../types.js';

export const YT_DEVICE: Device = {
  id: 'yt-embed',
  name: 'YouTube',
  type: 'Computer',
  volumePercent: 100,
};

// IFrame Player API state codes (developers.google.com/youtube/iframe_api_reference).
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export type YouTubePlayerSnapshot = {
  /** IFrame Player state code (-1, 0, 1, 2, 3, 5). */
  playerState: number;
  /** Seconds — output of getCurrentTime(). */
  currentTime: number;
  /** Seconds — output of getDuration(). */
  duration: number;
  /** Output of getVolume() (0-100). May be undefined if not yet initialized. */
  volume?: number;
  /** Currently-loaded video metadata, when known. */
  video: { videoId: string; title?: string } | null;
  /** True if the player has reported `ready`. */
  ready: boolean;
};

/**
 * Pure mapper: IFrame Player snapshot → PlaybackState. No side effects, no globals.
 *
 * - Player not ready → 'no-device'
 * - Ready but no video loaded → 'idle'
 * - Loaded + state=PAUSED/CUED/UNSTARTED → 'paused'
 * - Loaded + state=PLAYING/BUFFERING → 'playing'
 * - Loaded + state=ENDED → 'paused' at the end position
 */
export function mapYouTubePlayerState(
  snap: YouTubePlayerSnapshot,
  now: number = Date.now(),
): PlaybackState {
  if (!snap.ready) return { kind: 'no-device' };
  const device: Device = {
    ...YT_DEVICE,
    volumePercent: typeof snap.volume === 'number' ? clampVol(snap.volume) : YT_DEVICE.volumePercent,
  };
  if (!snap.video) return { kind: 'idle', device };

  const durationMs = Math.max(0, Math.round(snap.duration * 1000));
  const positionMs = Math.max(0, Math.round(snap.currentTime * 1000));
  const track: Track = {
    id: snap.video.videoId,
    title: snap.video.title ?? snap.video.videoId,
    artists: [],
    album: { name: '', artUrl: thumbnailUrl(snap.video.videoId) },
    durationMs,
  };

  const isPlaying = snap.playerState === YT_STATE.PLAYING || snap.playerState === YT_STATE.BUFFERING;
  return {
    kind: isPlaying ? 'playing' : 'paused',
    device,
    track,
    positionMs,
    isPlaying,
    asOf: now,
    shuffle: false,
    repeat: 'off',
  };
}

function clampVol(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const URL_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];

/**
 * Extract a YouTube video id from either a bare ID or a YouTube URL.
 * Returns null if the input doesn't match.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (VIDEO_ID_RE.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!URL_HOSTS.includes(url.hostname)) return null;
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID_RE.test(v)) return v;
  // /embed/<id> or /shorts/<id>
  const m = url.pathname.match(/^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1] ?? null;
  return null;
}
