import { useEffect, useState } from 'react';
import type { PlaybackState } from '../../electron/types';

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Local 1Hz tween of position between polls, anchored on the asOf timestamp. */
function useTweenedPosition(state: PlaybackState): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (state.kind !== 'playing' && state.kind !== 'paused') return 0;
  if (!state.isPlaying) return state.positionMs;
  const elapsed = now - state.asOf;
  return Math.min(state.track.durationMs, state.positionMs + elapsed);
}

export function NowPlaying({ state }: { state: PlaybackState }): JSX.Element {
  const position = useTweenedPosition(state);

  if (state.kind === 'no-device') {
    return (
      <div style={emptyStyle}>
        <div className="glow-text" style={{ fontSize: 18, letterSpacing: '0.1em' }}>
          NO ACTIVE DEVICE
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
          Open Spotify on your phone or Mac, then come back.
        </div>
      </div>
    );
  }

  if (state.kind === 'idle') {
    return (
      <div style={emptyStyle}>
        <div className="glow-text-cyan" style={{ fontSize: 18, letterSpacing: '0.1em' }}>
          // IDLE //
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 8 }}>
          Connected to {state.device.name}
        </div>
      </div>
    );
  }

  const { track } = state;
  const pct = track.durationMs > 0 ? Math.min(100, (position / track.durationMs) * 100) : 0;

  return (
    <div style={{ padding: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div
        style={{
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 6,
          background: 'var(--bg-elev)',
          border: '1px solid var(--accent)',
          boxShadow: 'var(--glow)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {track.album.artUrl ? (
          <img
            src={track.album.artUrl}
            alt={track.album.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>no art</div>
        )}
      </div>
      <div>
        <div
          className="glow-text"
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {track.title}
        </div>
        <div
          style={{
            color: 'var(--text-dim)',
            fontSize: 13,
            marginTop: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {track.artists.join(', ')} · {track.album.name}
        </div>
      </div>
      <div>
        <div
          style={{
            position: 'relative',
            height: 4,
            background: 'rgba(125, 128, 148, 0.2)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: `${pct}%`,
              background: 'var(--accent-2)',
              boxShadow: 'var(--glow-2)',
              transition: 'width 250ms linear',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 6,
            fontSize: 11,
            color: 'var(--text-dim)',
          }}
        >
          <span>{fmt(position)}</span>
          <span>{fmt(track.durationMs)}</span>
        </div>
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};
