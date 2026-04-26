import type { ReactNode } from 'react';

const styles: Record<string, React.CSSProperties> = {
  frame: {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: 'var(--bg)',
    border: '1px solid rgba(255, 62, 200, 0.25)',
    boxShadow: 'inset 0 0 60px rgba(255, 62, 200, 0.08), 0 0 12px rgba(255, 62, 200, 0.15)',
    overflow: 'hidden',
    animation: 'flicker 5s infinite',
  },
  scanlines: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    background:
      'repeating-linear-gradient(to bottom, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px)',
    opacity: 'var(--scanline-opacity)' as unknown as number,
    zIndex: 100,
    mixBlendMode: 'multiply',
  },
  vignette: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    background:
      'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)',
    zIndex: 99,
  },
};

export function NeonFrame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={styles.frame}>
      {children}
      <div style={styles.vignette} />
      <div style={styles.scanlines} />
    </div>
  );
}
