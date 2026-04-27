import { describe, it, expect } from 'vitest';
import { createYouTubePoller, type YouTubeControl } from '../youtube/poller.js';
import { YT_STATE, type YouTubePlayerSnapshot } from '../youtube/mapper.js';
import type { PlaybackState } from '../types.js';

function harness(opts: { advanceQueue?: (dir: 'next' | 'prev') => string | null } = {}) {
  const emits: PlaybackState[] = [];
  const sent: YouTubeControl[] = [];
  let requestStateCount = 0;
  const poller = createYouTubePoller({
    emit: (s) => emits.push(s),
    sendControl: (cmd) => sent.push(cmd),
    requestState: () => {
      requestStateCount++;
    },
    advanceQueue: opts.advanceQueue,
  });
  return {
    poller,
    emits,
    sent,
    last: (): PlaybackState | undefined => emits[emits.length - 1],
    requestStateCount: () => requestStateCount,
  };
}

const READY_SNAP: YouTubePlayerSnapshot = {
  ready: true,
  playerState: YT_STATE.PLAYING,
  currentTime: 1.0,
  duration: 100,
  video: { videoId: 'abcdefghijk', title: 'X' },
};

describe('createYouTubePoller — applySnapshot emits PlaybackState', () => {
  it('first ready snapshot maps and emits a playing PlaybackState', () => {
    const h = harness();
    h.poller.applySnapshot(READY_SNAP);
    const s = h.last();
    if (!s || s.kind !== 'playing') throw new Error('expected playing');
    expect(s.device.name).toBe('YouTube');
    expect(s.track.id).toBe('abcdefghijk');
  });

  it('not-ready snapshot emits no-device', () => {
    const h = harness();
    h.poller.applySnapshot({ ...READY_SNAP, ready: false });
    expect(h.last()).toEqual({ kind: 'no-device' });
  });

  it('ready but no video → idle', () => {
    const h = harness();
    h.poller.applySnapshot({ ...READY_SNAP, video: null });
    const s = h.last();
    if (!s || s.kind !== 'idle') throw new Error('expected idle');
    expect(s.device.id).toBe('yt-embed');
  });
});

describe('createYouTubePoller — control commands forward to renderer', () => {
  it('play() sends { kind: "play" }', () => {
    const h = harness();
    h.poller.play();
    expect(h.sent).toEqual([{ kind: 'play' }]);
  });

  it('pause() sends { kind: "pause" }', () => {
    const h = harness();
    h.poller.pause();
    expect(h.sent).toEqual([{ kind: 'pause' }]);
  });

  it('seek(ms) forwards positionMs', () => {
    const h = harness();
    h.poller.seek(45_000);
    expect(h.sent).toEqual([{ kind: 'seek', positionMs: 45_000 }]);
  });

  it('setVolume(percent) forwards percent', () => {
    const h = harness();
    h.poller.setVolume(33);
    expect(h.sent).toEqual([{ kind: 'volume', percent: 33 }]);
  });

  it('loadVideoId forwards the id', () => {
    const h = harness();
    h.poller.loadVideoId('newid123456');
    expect(h.sent).toEqual([{ kind: 'loadVideoId', videoId: 'newid123456' }]);
  });
});

describe('createYouTubePoller — next/prev consult the queue', () => {
  it('next() routes through the queue when one is provided', () => {
    const h = harness({ advanceQueue: (dir) => (dir === 'next' ? 'queueNxt001' : null) });
    h.poller.next();
    expect(h.sent).toEqual([{ kind: 'loadVideoId', videoId: 'queueNxt001' }]);
  });

  it('prev() falls back to native prev when queue returns null', () => {
    const h = harness({ advanceQueue: () => null });
    h.poller.prev();
    expect(h.sent).toEqual([{ kind: 'prev' }]);
  });

  it('without an advanceQueue dep, next()/prev() send native commands', () => {
    const h = harness();
    h.poller.next();
    h.poller.prev();
    expect(h.sent).toEqual([{ kind: 'next' }, { kind: 'prev' }]);
  });
});

describe('createYouTubePoller — pollNow asks renderer for fresh state', () => {
  it('pollNow() invokes requestState', async () => {
    const h = harness();
    await h.poller.pollNow();
    expect(h.requestStateCount()).toBe(1);
    h.poller.stop();
  });

  it('start() invokes requestState immediately', () => {
    const h = harness();
    h.poller.start();
    expect(h.requestStateCount()).toBeGreaterThanOrEqual(1);
    h.poller.stop();
  });
});

describe('createYouTubePoller — getState returns last applied snapshot mapped', () => {
  it('starts as no-device before any snapshot', () => {
    const h = harness();
    expect(h.poller.getState()).toEqual({ kind: 'no-device' });
  });

  it('reflects the last applied snapshot', () => {
    const h = harness();
    h.poller.applySnapshot(READY_SNAP);
    const s = h.poller.getState();
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.track.id).toBe('abcdefghijk');
  });
});
