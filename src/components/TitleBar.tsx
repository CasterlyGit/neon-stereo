export function TitleBar(): JSX.Element {
  return (
    <div
      className="titlebar"
      style={{
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 12px',
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
      }}
    >
      <span className="glow-text-cyan" style={{ fontWeight: 600 }}>
        NEON · STEREO
      </span>
    </div>
  );
}
