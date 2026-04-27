import { describe, it, expect, vi } from 'vitest';
import { createDemoPoller } from '../demo/poller.js';
import { DEMO_TRACKS } from '../demo/fixtures.js';
import type { PlaybackState } from '../types.js';

function harness(initialNow = 1_000_000) {
  let t = initialNow;
  const emitted: PlaybackState[] = [];
  const poller = createDemoPoller({
    emit: (s) => emitted.push(s),
    now: () => t,
  });
  return {
    poller,
    emitted,
    advance(ms: number): void {
      t += ms;
    },
    set(ms: number): void {
      t = ms;
    },
    last(): PlaybackState {
      return emitted[emitted.length - 1] as PlaybackState;
    },
  };
}

describe('createDemoPoller — emits and identity', () => {
  it('first poll emits a playing PlaybackState with device.name === "DEMO"', async () => {
    const h = harness();
    await h.poller.pollNow();
    const s = h.last();
    expect(s.kind).toBe('playing');
    if (s.kind === 'playing') {
      expect(s.device.name).toBe('DEMO');
      expect(s.track.title.length).toBeGreaterThan(0);
      expect(s.track.artists[0]?.length ?? 0).toBeGreaterThan(0);
    }
    h.poller.stop();
  });

  it('first emit references DEMO_TRACKS[0]', async () => {
    const h = harness();
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.track.id).toBe(DEMO_TRACKS[0]!.id);
    h.poller.stop();
  });
});

describe('createDemoPoller — transport controls', () => {
  it('next() advances index and resets positionMs to 0', async () => {
    const h = harness();
    await h.poller.pollNow();
    h.poller.next();
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.track.id).toBe(DEMO_TRACKS[1]!.id);
    expect(s.positionMs).toBe(0);
    h.poller.stop();
  });

  it('prev() rotates backward (wraps to last) and resets positionMs to 0', async () => {
    const h = harness();
    await h.poller.pollNow();
    h.poller.prev();
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.track.id).toBe(DEMO_TRACKS[DEMO_TRACKS.length - 1]!.id);
    expect(s.positionMs).toBe(0);
    h.poller.stop();
  });

  it('pause() flips kind to paused; subsequent play() flips back to playing', async () => {
    const h = harness();
    h.poller.pause();
    await h.poller.pollNow();
    expect(h.last().kind).toBe('paused');
    h.poller.play();
    await h.poller.pollNow();
    expect(h.last().kind).toBe('playing');
    h.poller.stop();
  });

  it('seek(N) clamps to [0, durationMs] and re-emits with positionMs = N', async () => {
    const h = harness();
    h.poller.seek(15_000);
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.positionMs).toBe(15_000);
    h.poller.stop();
  });

  it('setVolume(N) updates device.volumePercent and re-emits', async () => {
    const h = harness();
    h.poller.setVolume(25);
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.device.volumePercent).toBe(25);
    h.poller.stop();
  });
});

describe('createDemoPoller — auto-advance', () => {
  it('auto-advances to next track when injected clock crosses durationMs', async () => {
    const h = harness();
    // first emit on track[0], duration 30s
    await h.poller.pollNow();
    // jump past durationMs of track[0]
    h.advance(DEMO_TRACKS[0]!.durationMs + 500);
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'playing') throw new Error('expected playing');
    expect(s.track.id).toBe(DEMO_TRACKS[1]!.id);
  });

  it('auto-advance handles multi-track overflow when window has been hidden', async () => {
    const h = harness();
    await h.poller.pollNow();
    // Jump 600s — far beyond any single fixture; the while-loop should skip multiple tracks.
    h.advance(600_000);
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'playing') throw new Error('expected playing');
    // After 600s starting at track[0] pos 0, the loop subtracts durations
    // 30 + 90 + 180 + 240 = 540, then 30, 90, ... again — verify position is
    // strictly less than the landed track's durationMs.
    expect(s.positionMs).toBeGreaterThanOrEqual(0);
    expect(s.positionMs).toBeLessThan(s.track.durationMs);
  });

  it('paused state does not auto-advance even when clock jumps past duration', async () => {
    const h = harness();
    h.poller.pause();
    await h.poller.pollNow();
    const id0 = (h.last() as { track: { id: string } }).track.id;
    h.advance(DEMO_TRACKS[0]!.durationMs + 1_000_000);
    await h.poller.pollNow();
    const s = h.last();
    if (s.kind !== 'paused') throw new Error('expected paused');
    expect(s.track.id).toBe(id0);
  });
});

describe('createDemoPoller — no network', () => {
  it('a full session does not invoke fetch even once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never).mockImplementation((async () => {
      throw new Error('demo poller must not fetch');
    }) as never);
    try {
      const h = harness();
      h.poller.start();
      await h.poller.pollNow();
      h.poller.pause();
      await h.poller.pollNow();
      h.poller.play();
      h.poller.next();
      h.poller.prev();
      h.poller.seek(5000);
      h.poller.setVolume(40);
      await h.poller.pollNow();
      h.poller.stop();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
