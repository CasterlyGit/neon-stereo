import type { Device } from '../../electron/types';

export function DeviceBadge({ device }: { device: Device | null }): JSX.Element {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        border: '1px solid var(--text-dim)',
        borderRadius: 999,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: device ? 'var(--accent-2)' : 'var(--text-dim)',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: device ? 'var(--accent-2)' : 'var(--text-dim)',
          boxShadow: device ? 'var(--glow-2)' : 'none',
        }}
      />
      {device ? device.name : 'no device'}
    </div>
  );
}
