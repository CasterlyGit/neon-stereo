import { describe, it, expect } from 'vitest';
import { cadenceFor, mapPlaybackResponse } from '../spotify/poller.js';

describe('poller.cadenceFor', () => {
  it('returns 1000ms when focused and visible', () => {
    expect(cadenceFor({ focused: true, hidden: false })).toBe(1000);
  });
  it('returns 5000ms when blurred but visible', () => {
    expect(cadenceFor({ focused: false, hidden: false })).toBe(5000);
  });
  it('returns null when hidden (suspended)', () => {
    expect(cadenceFor({ focused: true, hidden: true })).toBeNull();
    expect(cadenceFor({ focused: false, hidden: true })).toBeNull();
  });
});

describe('poller.mapPlaybackResponse', () => {
  it('204 → no-device', () => {
    expect(mapPlaybackResponse(204, null)).toEqual({ kind: 'no-device' });
  });

  it('body.device==null → no-device', () => {
    expect(mapPlaybackResponse(200, { device: null })).toEqual({ kind: 'no-device' });
  });

  it('item==null but device present → idle', () => {
    const res = mapPlaybackResponse(200, {
      device: { id: 'd', name: 'Phone', type: 'Smartphone', volume_percent: 50 },
      item: null,
    });
    expect(res.kind).toBe('idle');
    if (res.kind === 'idle') expect(res.device.name).toBe('Phone');
  });

  it('item.type !== "track" → idle (defensive against episodes)', () => {
    const res = mapPlaybackResponse(200, {
      device: { id: 'd', name: 'Phone', type: 'Smartphone', volume_percent: 50 },
      item: { type: 'episode', id: 'ep', name: 'Podcast' },
    });
    expect(res.kind).toBe('idle');
  });

  it('playing with track + asOf timestamp', () => {
    const now = 1_700_000_000_000;
    const res = mapPlaybackResponse(
      200,
      {
        is_playing: true,
        progress_ms: 51234,
        device: { id: 'abc', name: "Tarun's iPhone", type: 'Smartphone', volume_percent: 60 },
        item: {
          id: 'trk1',
          type: 'track',
          name: 'Song Name',
          duration_ms: 215000,
          artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
          album: { name: 'Album', images: [{ url: 'https://example.com/art.jpg' }] },
        },
        shuffle_state: false,
        repeat_state: 'off',
      },
      now,
    );
    expect(res.kind).toBe('playing');
    if (res.kind === 'playing') {
      expect(res.track.title).toBe('Song Name');
      expect(res.track.artists[0]).toBe('Artist A');
      expect(res.track.album.artUrl).toBe('https://example.com/art.jpg');
      expect(res.device.name).toBe("Tarun's iPhone");
      expect(res.positionMs).toBe(51234);
      expect(res.asOf).toBe(now);
    }
  });

  it('paused when is_playing is false', () => {
    const res = mapPlaybackResponse(200, {
      is_playing: false,
      progress_ms: 0,
      device: { id: 'd', name: 'Phone', type: 'Smartphone', volume_percent: 50 },
      item: {
        id: 't',
        type: 'track',
        name: 'X',
        duration_ms: 1000,
        artists: [{ name: 'Y' }],
        album: { name: 'Z', images: [] },
      },
    });
    expect(res.kind).toBe('paused');
  });
});
