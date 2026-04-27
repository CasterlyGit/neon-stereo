import { useState } from 'react';
import { parseVideoId } from '../../electron/youtube/mapper';

export function UrlPasteBar(): JSX.Element {
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) return;
    const id = parseVideoId(trimmed);
    if (!id) {
      setErr('paste a youtube url or 11-char video id');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await window.neonStereo.youtube.loadVideoId(id);
      setValue('');
    } catch (e: unknown) {
      const msg = (e as { message?: string } | null)?.message ?? 'failed to load';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="no-drag"
      style={{ padding: '0 24px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={value}
          placeholder="paste youtube url or video id"
          onChange={(e) => {
            setValue(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          style={{
            flex: 1,
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid var(--text-dim)',
            color: 'var(--text)',
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={busy || !value}
          style={{
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            padding: '6px 14px',
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: 'rgba(255, 62, 200, 0.05)',
          }}
        >
          {busy ? '…' : 'load'}
        </button>
      </div>
      {err && <div style={{ color: '#ff5566', fontSize: 11 }}>{err}</div>}
    </div>
  );
}
