import { useEffect, useRef, useState } from 'react';
import type { PlaybackState, Provider } from '../../electron/types';

type Toast = { kind: 'error' | 'info'; text: string } | null;

function useDebounced<T>(value: T, delay: number, onCommit: (v: T) => void): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(value), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

export function Transport({
  state,
  provider = 'spotify',
}: {
  state: PlaybackState;
  provider?: Provider;
}): JSX.Element {
  const active = state.kind === 'playing' || state.kind === 'paused';
  const isPlaying = state.kind === 'playing';
  const trackDuration = active ? state.track.durationMs : 0;
  const initialPosition = active ? state.positionMs : 0;
  const initialVolume = active || state.kind === 'idle' ? state.device.volumePercent : 50;

  const [scrubbing, setScrubbing] = useState(false);
  const [scrubMs, setScrubMs] = useState(initialPosition);
  const [volume, setVolume] = useState(initialVolume);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    if (!scrubbing && active) setScrubMs(state.positionMs);
  }, [active, scrubbing, state]);
  useEffect(() => {
    if (active || state.kind === 'idle') setVolume(state.device.volumePercent);
  }, [state, active]);

  const showToast = (text: string): void => {
    setToast({ kind: 'error', text });
    setTimeout(() => setToast(null), 4000);
  };

  const safe = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      if (code === 'PREMIUM_REQUIRED' && provider === 'spotify') {
        showToast('Spotify Premium is required to control playback');
      } else if (code === 'NETWORK_ERROR') {
        showToast(
          provider === 'youtube'
            ? "Couldn't reach YouTube — check your connection."
            : "Couldn't reach Spotify — check your connection.",
        );
      } else if (code === 'YT_NETWORK_ERROR') {
        showToast("Couldn't reach YouTube — check your connection.");
      } else if (code === 'RATE_LIMITED') {
        showToast('Rate limited, try again in a moment.');
      } else if (code === 'YT_VIDEO_UNAVAILABLE') {
        showToast('Video unavailable — try a different one.');
      } else if (code === 'YT_EMBED_DISABLED') {
        showToast('This video disables embedding — pick another.');
      } else if (code === 'YT_PLAYER_NOT_READY') {
        showToast('YouTube player not ready yet — give it a sec.');
      } else {
        const msg = (e as { message?: string } | null)?.message ?? 'Something went wrong';
        showToast(msg);
      }
    }
  };

  useDebounced(scrubMs, 200, (ms) => {
    if (scrubbing && active) void safe(() => window.neonStereo.player.seek(ms));
  });
  useDebounced(volume, 200, (v) => {
    if (active || state.kind === 'idle') void safe(() => window.neonStereo.player.setVolume(v));
  });

  const disabled = !active;

  return (
    <div style={{ padding: '8px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input
        className="no-drag"
        type="range"
        min={0}
        max={Math.max(1, trackDuration)}
        value={scrubMs}
        disabled={disabled}
        onMouseDown={() => setScrubbing(true)}
        onMouseUp={() => setScrubbing(false)}
        onTouchStart={() => setScrubbing(true)}
        onTouchEnd={() => setScrubbing(false)}
        onChange={(e) => setScrubMs(parseInt(e.target.value, 10))}
      />
      <div
        className="no-drag"
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}
      >
        <button
          disabled={disabled}
          onClick={() => void safe(() => window.neonStereo.player.prev())}
          style={btnStyle()}
        >
          ⏮
        </button>
        <button
          disabled={disabled}
          onClick={() =>
            void safe(() =>
              isPlaying ? window.neonStereo.player.pause() : window.neonStereo.player.play(),
            )
          }
          style={btnStyle(true)}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          disabled={disabled}
          onClick={() => void safe(() => window.neonStereo.player.next())}
          style={btnStyle()}
        >
          ⏭
        </button>
      </div>
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>VOL</span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          disabled={disabled && state.kind !== 'idle'}
          onChange={(e) => setVolume(parseInt(e.target.value, 10))}
        />
        <span style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 24, textAlign: 'right' }}>
          {volume}
        </span>
      </div>
      {toast && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            left: 24,
            right: 24,
            bottom: 12,
            padding: '8px 12px',
            background: 'rgba(255, 62, 200, 0.1)',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            textShadow: 'var(--glow)',
            borderRadius: 4,
            fontSize: 12,
            textAlign: 'center',
            zIndex: 200,
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function btnStyle(big = false): React.CSSProperties {
  return {
    width: big ? 56 : 44,
    height: big ? 56 : 44,
    fontSize: big ? 22 : 16,
    borderRadius: '50%',
    border: `1px solid ${big ? 'var(--accent)' : 'var(--text-dim)'}`,
    color: big ? 'var(--accent)' : 'var(--text)',
    boxShadow: big ? 'var(--glow)' : undefined,
    background: big ? 'rgba(255, 62, 200, 0.06)' : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };
}
