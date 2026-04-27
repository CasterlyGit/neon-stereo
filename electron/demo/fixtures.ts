import type { Device, Track } from '../types.js';

export const DEMO_DEVICE: Device = {
  id: 'demo',
  name: 'DEMO',
  type: 'Computer',
  volumePercent: 60,
};

function svgArt(label: string, bg: string, fg: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">` +
    `<rect width="300" height="300" fill="${bg}"/>` +
    `<text x="150" y="160" font-family="ui-monospace,Menlo,monospace" font-size="32" font-weight="700" fill="${fg}" text-anchor="middle" letter-spacing="6">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const DEMO_TRACKS: Track[] = [
  {
    id: 'demo-1',
    title: 'Neon Drift',
    artists: ['Synthwave Dreams'],
    album: { name: 'After Hours', artUrl: svgArt('NEON', '#1a0030', '#ff3ec8') },
    durationMs: 30_000,
  },
  {
    id: 'demo-2',
    title: 'Midnight Cassette',
    artists: ['VHS Ghost', 'Retro Pulse'],
    album: { name: 'Magnetic Tape', artUrl: svgArt('CASSETTE', '#001a30', '#3ec8ff') },
    durationMs: 90_000,
  },
  {
    id: 'demo-3',
    title: 'Static Kingdom',
    artists: ['Channel 12'],
    album: { name: 'No Signal', artUrl: null },
    durationMs: 180_000,
  },
  {
    id: 'demo-4',
    title: 'Aurora Highway',
    artists: ['Polar Drive'],
    album: { name: 'Eastbound', artUrl: svgArt('AURORA', '#003020', '#3eff8e') },
    durationMs: 240_000,
  },
];
