import { useEffect, useState } from 'react';
import type { PlaybackState, Provider } from '../../electron/types';
import { TitleBar } from './TitleBar';
import { NowPlaying } from './NowPlaying';
import { Transport } from './Transport';
import { DeviceBadge } from './DeviceBadge';
import { YouTubeEmbed } from './YouTubeEmbed';

export function Dashboard(): JSX.Element {
  const [state, setState] = useState<PlaybackState>({ kind: 'no-device' });
  const [provider, setProvider] = useState<Provider>('spotify');

  useEffect(() => {
    let mounted = true;
    void window.neonStereo.player.get().then((s) => {
      if (mounted) setState(s);
    });
    void window.neonStereo.provider.getActive().then((p) => {
      if (mounted) setProvider(p);
    });
    const off = window.neonStereo.player.onState((s) => setState(s));
    return () => {
      mounted = false;
      off();
    };
  }, []);

  const device =
    state.kind === 'idle' || state.kind === 'playing' || state.kind === 'paused'
      ? state.device
      : null;

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TitleBar />
      <div
        style={{
          padding: '4px 24px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <DeviceBadge device={device} />
        <button
          className="no-drag"
          style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}
          onClick={() => void window.neonStereo.auth.logout()}
        >
          disconnect
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <NowPlaying state={state} />
      </div>
      <Transport state={state} provider={provider} />
      {provider === 'youtube' && <YouTubeEmbed />}
    </div>
  );
}
