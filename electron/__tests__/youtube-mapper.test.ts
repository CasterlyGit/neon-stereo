import { describe, it, expect } from 'vitest';
import {
  YT_STATE,
  mapYouTubePlayerState,
  parseVideoId,
  type YouTubePlayerSnapshot,
} from '../youtube/mapper.js';

function snap(partial: Partial<YouTubePlayerSnapshot> = {}): YouTubePlayerSnapshot {
  return {
    playerState: YT_STATE.UNSTARTED,
    currentTime: 0,
    duration: 0,
    video: null,
    ready: true,
    ...partial,
  };
}

describe('mapYouTubePlayerState — readiness gating', () => {
  it('not ready → no-device', () => {
    expect(mapYouTubePlayerState(snap({ ready: false }))).toEqual({ kind: 'no-device' });
  });

  it('ready but no video loaded → idle on yt-embed device', () => {
    const s = mapYouTubePlayerState(snap({ ready: true, video: null }));
    expect(s.kind).toBe('idle');
    if (s.kind === 'idle') {
      expect(s.device.id).toBe('yt-embed');
      expect(s.device.name).toBe('YouTube');
    }
  });
});

describe('mapYouTubePlayerState — state transitions', () => {
  const video = { videoId: 'abc12345678', title: 'Some Track' };

  it('PLAYING → kind=playing with positionMs derived from currentTime', () => {
    const now = 1_700_000_000_000;
    const s = mapYouTubePlayerState(
      snap({
        ready: true,
        playerState: YT_STATE.PLAYING,
        currentTime: 12.5,
        duration: 200,
        video,
      }),
      now,
    );
    expect(s.kind).toBe('playing');
    if (s.kind === 'playing') {
      expect(s.positionMs).toBe(12500);
      expect(s.track.durationMs).toBe(200_000);
      expect(s.track.id).toBe('abc12345678');
      expect(s.track.title).toBe('Some Track');
      expect(s.asOf).toBe(now);
    }
  });

  it('PAUSED → kind=paused', () => {
    const s = mapYouTubePlayerState(
      snap({ ready: true, playerState: YT_STATE.PAUSED, video, duration: 1, currentTime: 0.5 }),
    );
    expect(s.kind).toBe('paused');
  });

  it('BUFFERING → kind=playing (still effectively in-flight)', () => {
    const s = mapYouTubePlayerState(
      snap({ ready: true, playerState: YT_STATE.BUFFERING, video, duration: 1 }),
    );
    expect(s.kind).toBe('playing');
  });

  it('CUED → kind=paused', () => {
    const s = mapYouTubePlayerState(
      snap({ ready: true, playerState: YT_STATE.CUED, video, duration: 1 }),
    );
    expect(s.kind).toBe('paused');
  });

  it('UNSTARTED with video loaded → kind=paused', () => {
    const s = mapYouTubePlayerState(
      snap({ ready: true, playerState: YT_STATE.UNSTARTED, video, duration: 1 }),
    );
    expect(s.kind).toBe('paused');
  });

  it('ENDED → kind=paused (preserves video metadata)', () => {
    const s = mapYouTubePlayerState(
      snap({ ready: true, playerState: YT_STATE.ENDED, video, duration: 60, currentTime: 60 }),
    );
    expect(s.kind).toBe('paused');
    if (s.kind === 'paused') {
      expect(s.track.id).toBe('abc12345678');
    }
  });
});

describe('mapYouTubePlayerState — volume passthrough', () => {
  it('clamps volume into [0, 100]', () => {
    const s = mapYouTubePlayerState(
      snap({
        ready: true,
        playerState: YT_STATE.PLAYING,
        video: { videoId: 'abc12345678' },
        duration: 1,
        volume: 217,
      }),
    );
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.device.volumePercent).toBe(100);
  });

  it('uses default volume when undefined', () => {
    const s = mapYouTubePlayerState(snap({ ready: true, video: null }));
    if (s.kind !== 'idle') throw new Error('expected idle');
    expect(s.device.volumePercent).toBe(100);
  });
});

describe('parseVideoId — accepts URLs and bare IDs', () => {
  it('11-char id passes through', () => {
    expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('full youtube.com/watch URL', () => {
    expect(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('youtu.be short URL', () => {
    expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('music.youtube.com URL', () => {
    expect(parseVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('embed URL', () => {
    expect(parseVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('shorts URL', () => {
    expect(parseVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('unknown host returns null', () => {
    expect(parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('garbage returns null', () => {
    expect(parseVideoId('hello world')).toBeNull();
    expect(parseVideoId('')).toBeNull();
    expect(parseVideoId('   ')).toBeNull();
  });

  it('id-too-short returns null', () => {
    expect(parseVideoId('short')).toBeNull();
  });
});
