import { useState } from 'react';
import { TitleBar } from './TitleBar';

export function ConnectScreen(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await window.neonStereo.auth.login();
    } catch (e: unknown) {
      const code = (e as { code?: string } | null)?.code;
      const msg = (e as { message?: string } | null)?.message ?? 'Connection failed';
      setErr(code === 'AUTH_CANCELLED' ? null : msg);
    } finally {
      setBusy(false);
    }
  }

  async function tryDemo(): Promise<void> {
    setDemoBusy(true);
    setErr(null);
    try {
      await window.neonStereo.auth.startDemo();
    } catch (e: unknown) {
      const msg = (e as { message?: string } | null)?.message ?? 'Demo failed to start';
      setErr(msg);
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <TitleBar />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 32,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            className="glow-text"
            style={{
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            neon-stereo
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12, letterSpacing: '0.1em' }}>
            // RETRO REMOTE FOR YOUR SPOTIFY //
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <button
            className="no-drag"
            onClick={() => void connect()}
            disabled={busy || demoBusy}
            style={{
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              textShadow: 'var(--glow)',
              boxShadow: 'var(--glow)',
              padding: '14px 32px',
              fontSize: 14,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              background: 'rgba(255, 62, 200, 0.05)',
            }}
          >
            {busy ? 'connecting…' : '▶  connect spotify'}
          </button>
          <button
            className="no-drag"
            onClick={() => void tryDemo()}
            disabled={busy || demoBusy}
            style={{
              border: '1px solid var(--text-dim)',
              color: 'var(--text-dim)',
              padding: '10px 28px',
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              background: 'transparent',
            }}
          >
            {demoBusy ? 'starting demo…' : '▶  try demo mode'}
          </button>
        </div>
        {err && (
          <div style={{ color: '#ff5566', fontSize: 12, maxWidth: 320, textAlign: 'center' }}>
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
